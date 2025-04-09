import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import fs from 'fs/promises'; // Gunakan fs/promises untuk async/await
import fetch from 'node-fetch'; // Pastikan node-fetch terinstall (npm i node-fetch) atau gunakan fetch bawaan Node v18+

dotenv.config();
const app = express();
const PORT = 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_NAME = 'gemini-1.5-flash-latest'; // Model default

// Middleware
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Melayani Frontend ---
const publicDir = path.join(__dirname, 'public');
// 1. Sajikan semua file statis dari folder 'public' (CSS, JS, gambar frontend)
app.use(express.static(publicDir));
// 2. Secara eksplisit kirim index.html saat user akses root '/'
app.get('/', (req, res) => {
    const indexPath = path.join(publicDir, 'index.html'); // Sesuaikan jika nama file bukan index.html
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error("Error sending index.html:", err);
            if (err.code === 'ENOENT') { // ENOENT = Error NO ENTry (file not found)
                res.status(404).send("File frontend utama (index.html) tidak ditemukan di folder 'public'.");
            } else {
                res.status(500).send("Server error saat mencoba mengirim halaman.");
            }
        }
    });
});
// ------------------------

// Konfigurasi Multer
const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Sajikan file dari folder uploads (untuk gambar balasan/preview)
app.use('/uploads', express.static(uploadDir));

// --- Helper Function to convert file to Gemini GenerativePart ---
async function fileToGenerativePart(filePath, mimeType) {
    try {
        const fileData = await fs.readFile(filePath);
        return {
            inlineData: {
                data: fileData.toString('base64'),
                mimeType
            },
        };
    } catch (error) {
        console.error("Error reading file for Gemini:", error);
        throw new Error("Gagal membaca file gambar untuk diproses.");
    }
}

// --- API Endpoint untuk Chat ---
app.post('/api/chat', upload.single('image'), async (req, res) => {
    const userMessage = req.body.message || "";
    const imageFile = req.file;
    let requestedModel = req.body.model || GEMINI_MODEL_NAME;

    console.log('Request Body:', req.body);
    console.log('File diterima:', imageFile);

    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY tidak ditemukan di .env");
        return res.status(500).json({ reply: 'Kesalahan konfigurasi server: API Key tidak ditemukan.' });
    }

    let promptParts = [];
    let imagePathForCleanup = null;

    if (userMessage) {
        promptParts.push({ text: userMessage });
    }

    if (imageFile) {
        try {
            const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
            if (!supportedMimeTypes.includes(imageFile.mimetype)) {
                throw new Error(`Tipe file tidak didukung: ${imageFile.mimetype}. Gunakan JPEG, PNG, WEBP, HEIC, atau HEIF.`);
            }
            const imagePart = await fileToGenerativePart(imageFile.path, imageFile.mimetype);
            promptParts.push(imagePart);
            imagePathForCleanup = imageFile.path;
            if (!userMessage) {
                promptParts.unshift({ text: "Describe this image." });
            }
            // Otomatis gunakan model gemini-1.5-flash-latest jika ada gambar
            requestedModel = 'gemini-1.5-flash-latest';
            console.log(`Menggunakan model: ${requestedModel} karena ada gambar.`);
        } catch (error) {
            console.error("Error processing image file:", error);
            if (imageFile && imageFile.path) {
                try { await fs.unlink(imageFile.path); } catch (e) { console.error("Gagal hapus file error:", e); }
            }
            return res.status(500).json({ reply: error.message || 'Gagal memproses file gambar.' });
        }
    }

    if (promptParts.length === 0) {
        return res.status(400).json({ reply: 'Mohon berikan pesan atau gambar.' });
    }

    try {
        console.log(`\n--- Memanggil Gemini API ---`);
        console.log(`Model: ${requestedModel}`);

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${GEMINI_API_KEY}`;
        const apiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: promptParts }],
            }),
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.json();
            console.error('Error from Gemini API:', errorBody);
            const errorMessage = errorBody?.error?.message || `API Error (${apiResponse.status})`;
            throw new Error(errorMessage);
        }

        const result = await apiResponse.json();
        console.log('Gemini Response:', JSON.stringify(result, null, 2));

        const reply = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, saya tidak mendapatkan jawaban yang valid.';
        console.log(`User Input Text : ${userMessage || "(Tidak ada teks)"}`);
        console.log(`Image Processed : ${imageFile ? imageFile.filename : "Tidak"}`);
        console.log(`Gemini Reply     : ${reply}`);
        console.log(`--------------------------\n`);

        res.json({
            reply: reply
        });

    } catch (error) {
        console.error('Error saat menghubungi Gemini atau memproses hasil:', error);
        res.status(500).json({ reply: `Terjadi kesalahan: ${error.message}` });
    } finally {
        // Opsional: Hapus file setelah diproses
        // if (imagePathForCleanup) {
        //     try { await fs.unlink(imagePathForCleanup); console.log("File upload dibersihkan:", imagePathForCleanup); }
        //     catch (e) { console.error("Gagal membersihkan file upload:", e); }
        // }
    }
});

// Jalankan server
app.listen(PORT, () => {
    console.log(`🚀 DexGpt server running at http://localhost:${PORT}`);
    console.log(`🔑 Menggunakan Gemini Key: ${GEMINI_API_KEY ? 'Ada' : 'TIDAK ADA!'}`);
    console.log(`🧠 Model Default: ${GEMINI_MODEL_NAME}`);
    console.log(`📂 Uploads ke: ${uploadDir}`);
    console.log(`📁 Frontend dari: ${publicDir}`); // Tambahkan log ini
});
