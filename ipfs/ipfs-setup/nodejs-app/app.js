import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import cors from 'cors';
import fetch from 'node-fetch';
import FormData from 'form-data';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50gb' }));
app.use(express.urlencoded({ extended: true, limit: '50gb' }));

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50 GB
  preservePath: true,
});

const MONGO_URI = 'mongodb://mongo1:27017,mongo2:27017,mongo3:27017/ipfs-data?replicaSet=rs0';
await mongoose.connect(MONGO_URI);
console.log("✅ MongoDB connected");

const redisClient = new Redis({
  sentinels: [
    { host: 'redis-sentinel1', port: 26379 },
    { host: 'redis-sentinel2', port: 26379 },
    { host: 'redis-sentinel3', port: 26379 }
  ],
  name: 'mymaster'
});

redisClient.on('connect', () => console.log("✅ Redis connected"));
redisClient.on('error', err => console.error("❌ Redis error:", err));

const File = mongoose.model('File', {
  filename: String,
  cid: String,
  size: Number,
  uploadedAt: Date,
  ip: String
});

const CLUSTER_API = 'http://cluster0:9094';
const IPFS_GATEWAYS = [
  'http://ipfs1:8080/ipfs',
  'http://ipfs2:8080/ipfs',
  'http://ipfs3:8080/ipfs',
  'http://ipfs4:8080/ipfs'
];

function getRealIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  if (req.headers['x-real-ip']) return req.headers['x-real-ip'];
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

app.post('/upload-folder', upload.array('file'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files received");
  }

  const uploaderIp = getRealIp(req);
  const folderName = req.body.folderName || `upload-${Date.now()}`;
  const folderPath = path.join('uploads', folderName);

  try {
    for (const file of req.files) {
      const relativePath = file.originalname;
      if (!relativePath) throw new Error(`Missing relative path for ${file.filename}`);
      const fullDestPath = path.join(folderPath, relativePath);
      await fse.ensureDir(path.dirname(fullDestPath));
      await fse.move(file.path, fullDestPath);
    }

    const form = new FormData();

    const addFilesRecursively = (dir, base = folderName) => {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relativePath = path.join(base, entry).split(path.sep).join('/');
        if (fs.statSync(fullPath).isDirectory()) {
          addFilesRecursively(fullPath, relativePath);
        } else {
          form.append('file', fs.createReadStream(fullPath), { filepath: relativePath });
        }
      }
    };
    addFilesRecursively(folderPath);

    const response = await fetch(
      `${CLUSTER_API}/add?recursive=true&wrap-with-directory=true&replication-min=2&replication-max=2`,
      {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      }
    );

    if (!response.ok) throw new Error("IPFS Cluster upload failed");

    const text = await response.text();
    const lines = text.trim().split('\n');

    let rootCid = null;
    for (const line of lines) {
      const obj = JSON.parse(line);
      if (obj.name === '' || obj.name === folderName || obj.name === '/') {
        rootCid = obj.cid['/'] || obj.cid;
        break;
      }
    }

    if (!rootCid) throw new Error("Root CID not found");

    await File.create({
      filename: folderName,
      cid: rootCid,
      size: req.files.reduce((sum, f) => sum + f.size, 0),
      uploadedAt: new Date(),
      ip: uploaderIp
    });

    await redisClient.set(rootCid, JSON.stringify({ folderName, rootCid }));

    console.log(`📁 Folder uploaded to IPFS Cluster with CID: ${rootCid}`);
    res.json({ message: 'Folder uploaded and pinned', cid: rootCid });

  } catch (err) {
    console.error("❌ Folder upload error:", err.message);
    res.status(500).send("Upload failed: " + err.message);
  } finally {
    await fse.remove(folderPath).catch(err =>
      console.warn(`⚠️ Cleanup failed for ${folderPath}:`, err.message)
    );
  }
});

app.get('/download/:cid', async (req, res) => {
  const cid = req.params.cid;
  const record = await File.findOne({ cid });
  const filename = record?.filename || cid;

  for (const gateway of IPFS_GATEWAYS) {
    try {
      const url = `${gateway}/${cid}`;
      const response = await fetch(url);
      const contentType = response.headers.get('content-type');

      if (response.ok && contentType && contentType !== 'text/html') {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        response.body.pipe(res);
        return;
      }
    } catch (err) {
      console.warn(`⚠️ ${gateway} fetch error: ${err.message}`);
    }
  }

  res.status(500).send('Download failed from all nodes');
});

app.get('/files', async (req, res) => {
  try {
    const files = await File.find().sort({ uploadedAt: -1 }).limit(20);
    for (const file of files) {
      try {
        const clusterRes = await fetch(`${CLUSTER_API}/pins/${file.cid}`);
        file._doc.replication = clusterRes.ok ? await clusterRes.json() : { error: "Cluster info unavailable" };
      } catch {
        file._doc.replication = { error: "Fetch failed" };
      }
    }
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

app.delete('/files/:cid', async (req, res) => {
  const { cid } = req.params;
  try {
    const deleted = await File.findOneAndDelete({ cid });
    if (!deleted) return res.status(404).json({ error: 'File not found' });

    await redisClient.del(cid);
    await fetch(`${CLUSTER_API}/pins/${cid}`, { method: 'DELETE' }).catch(err =>
      console.warn(`⚠️ Failed to unpin ${cid}: ${err.message}`)
    );

    console.log(`🗑 Deleted CID: ${cid}`);
    res.json({ message: 'File deleted' });
  } catch (err) {
    console.error("❌ Delete error:", err.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.listen(3000, () => console.log('🚀 Uploader API running on port 3000'));

