/**
 * streamly-server - Gelişmiş Node.js backend müzik uygulaması
 * 
 * Özellikler:
 * - REST API: Şarkı ekle, sil, güncelle, listele, favori yap, dinlenme sayısı arttır.
 * - JSON dosya tabanlı kalıcı veri yönetimi.
 * - Güvenlik: Helmet, CORS, Rate Limiting.
 * - Performans: Compression, morgan logging.
 * - SPA frontend için public klasörünü serve eder.
 * - Hataları yakalar, kapsamlı yorumlarla temiz ve okunabilir.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- Ayarlar ---
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'songs.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Express app oluştur ---
const app = express();

// --- Middlewareler ---
// Güvenlik başlıkları
app.use(helmet());

// CORS - istekleri tüm domainlerden kabul et, ihtiyaca göre sınırlandırılabilir
app.use(cors());

// HTTP istek sıkıştırma - performans artırır
app.use(compression());

// İsteklerin loglanması (combined format)
// Üretim ortamı için dosyaya loglama vs. eklenebilir
app.use(morgan('combined'));

// JSON body parse et, maksimum 1 MB boyut sınırı
app.use(bodyParser.json({ limit: '1mb' }));

// Rate limiting - API endpointlerine aşırı istek engelleme (DDoS koruma)
// 10 istek/saniye sınırı
const limiter = rateLimit({
  windowMs: 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek, lütfen yavaşlayın.' }
});
app.use('/api/', limiter);

// Public klasöründen statik dosyaları serve et (frontend burada olacak)
app.use(express.static(PUBLIC_DIR));

// --- Yardımcı fonksiyonlar ---

/**
 * songs.json dosyasından tüm şarkıları oku
 * Eğer dosya yoksa oluşturup boş liste döner
 * @returns {Promise<Array>} Şarkılar dizisi
 */
async function readSongs() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await saveSongs([]);
      return [];
    }
    throw err;
  }
}

/**
 * Şarkıları songs.json dosyasına yaz
 * @param {Array} songs Şarkılar dizisi
 */
async function saveSongs(songs) {
  await fs.writeFile(DATA_FILE, JSON.stringify(songs, null, 2), 'utf-8');
}

/**
 * İsteklerde hata olursa buradan standart JSON ile dön
 * @param {object} res Express response objesi
 * @param {number} status HTTP durum kodu
 * @param {string} message Hata mesajı
 */
function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

// --- API ROUTES ---

// GET /api/songs - Tüm şarkılar, opsiyonel query ile filtre ve sıralama
app.get('/api/songs', async (req, res) => {
  try {
    let songs = await readSongs();

    // Query parametreleri: filter, sortBy, order
    const filter = req.query.filter || null; // favorites veya null
    const sortBy = req.query.sortBy || 'createdAt'; // count, createdAt, name
    const order = req.query.order === 'asc' ? 1 : -1; // asc veya desc

    if (filter === 'favorites') {
      songs = songs.filter(s => s.favori === true);
    }

    songs.sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];
      if (valA < valB) return -1 * order;
      if (valA > valB) return 1 * order;
      return 0;
    });

    res.json(songs);
  } catch (err) {
    console.error('GET /api/songs hata:', err);
    sendError(res, 500, 'Sunucu hatası, şarkılar alınamadı');
  }
});

// GET /api/songs/:id - Tek şarkı detayları
app.get('/api/songs/:id', async (req, res) => {
  try {
    const songs = await readSongs();
    const song = songs.find(s => s.id === req.params.id);
    if (!song) return sendError(res, 404, 'Şarkı bulunamadı');
    res.json(song);
  } catch (err) {
    console.error(`GET /api/songs/${req.params.id} hata:`, err);
    sendError(res, 500, 'Sunucu hatası');
  }
});

// POST /api/songs - Yeni şarkı ekle
app.post('/api/songs', async (req, res) => {
  try {
    const { name, file, cover } = req.body;
    if (!name || !file) return sendError(res, 400, 'Şarkı adı ve dosya URL zorunlu');

    const songs = await readSongs();

    // Aynı dosya URL’si varsa izin verme (opsiyonel)
    const duplicate = songs.find(s => s.file === file);
    if (duplicate) return sendError(res, 409, 'Bu şarkı zaten kayıtlı');

    const newSong = {
      id: uuidv4(),
      name: name.trim(),
      file: file.trim(),
      cover: cover ? cover.trim() : '',
      count: 0,
      favori: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    songs.push(newSong);
    await saveSongs(songs);

    res.status(201).json(newSong);
  } catch (err) {
    console.error('POST /api/songs hata:', err);
    sendError(res, 500, 'Sunucu hatası');
  }
});

// PUT /api/songs/:id/play - Dinlenme sayısını artır
app.put('/api/songs/:id/play', async (req, res) => {
  try {
    const songs = await readSongs();
    const idx = songs.findIndex(s => s.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'Şarkı bulunamadı');

    songs[idx].count++;
    songs[idx].updatedAt = new Date().toISOString();
    await saveSongs(songs);

    res.json({ success: true, count: songs[idx].count });
  } catch (err) {
    console.error(`PUT /api/songs/${req.params.id}/play hata:`, err);
    sendError(res, 500, 'Sunucu hatası');
  }
});

// PUT /api/songs/:id/favorite - Favori durumunu değiştir
app.put('/api/songs/:id/favorite', async (req, res) => {
  try {
    const songs = await readSongs();
    const idx = songs.findIndex(s => s.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'Şarkı bulunamadı');

    songs[idx].favori = !songs[idx].favori;
    songs[idx].updatedAt = new Date().toISOString();
    await saveSongs(songs);

    res.json({ success: true, favori: songs[idx].favori });
  } catch (err) {
    console.error(`PUT /api/songs/${req.params.id}/favorite hata:`, err);
    sendError(res, 500, 'Sunucu hatası');
  }
});

// DELETE /api/songs/:id - Şarkı sil
app.delete('/api/songs/:id', async (req, res) => {
  try {
    const songs = await readSongs();
    const newList = songs.filter(s => s.id !== req.params.id);
    if (newList.length === songs.length) return sendError(res, 404, 'Şarkı bulunamadı');

    await saveSongs(newList);
    res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/songs/${req.params.id} hata:`, err);
    sendError(res, 500, 'Sunucu hatası');
  }
});

// GET /api/health - Sağlık kontrol endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', time: new Date().toISOString() });
});

// Tüm bilinmeyen route'ları SPA frontend için index.html'e yönlendir
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Server başlat
app.listen(PORT, () => {
  console.log(`Streamly backend server http://localhost:${PORT} üzerinde çalışıyor.`);
});
