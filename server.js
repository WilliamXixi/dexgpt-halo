import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();
const app = express();
const PORT = 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'models/gemini-2.0-flash'; // Mengubah model ke Gemini 2.0 Flash

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint buat chat
app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }]
        })
      }
    );

    const result = await response.json();
    console.log('Gemini Response:', result); // Tetap ada buat debug

    const reply = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'Tidak ada jawaban.';

    // Tambahan log yang rapi
    console.log(`\n=== Chat ===`);
    console.log(`User   : ${userMessage}`);
    console.log(`Gemini : ${reply}`);
    console.log(`============\n`);

    res.json({ reply });

  } catch (error) {
    console.error('Error from Gemini:', error);
    res.status(500).json({ reply: 'Terjadi kesalahan saat memproses permintaan.' });
  }
});

app.listen(PORT, () => {
  console.log(`DexGpt server running at http://localhost:${PORT}`);
});
