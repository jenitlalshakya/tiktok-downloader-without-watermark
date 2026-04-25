const express = require('express');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream');

require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add Dynamic Footer Date
app.get('/', (req, res) => {
    const year = new Date().getFullYear();
    const filePath = path.join(__dirname, 'public', 'index.html');

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).send('Error reading file');
        const html = data.replace(/{{year}}/g, year);
        res.send(html);
    });
});

app.use(express.static('public'));

// Helper function to generate filenames
function generateFilename(username, videoId, type = 'video', index = 1) {
    username = username || 'unknown_user';
    videoId = videoId || 'unknown_id';

    if (type === 'video') return `@${username}_${videoId}.mp4`;
    if (type === 'image') return `@${username}_${videoId}_img${index}.jpg`;
    if (type === 'thumbnail') return `@${username}_${videoId}_thumbnail.jpg`;
    return `@${username}_${videoId}`;
}

// API endpoint to fetch TikTok data
app.get('/api/download', async (req, res) => {
    try {
        const tiktokUrl = req.query.url || req.body.url;
        if (!tiktokUrl) return res.status(400).json({ success: false, message: 'Please provide a TikTok URL' });
        if (!tiktokUrl.includes('tiktok.com')) return res.status(400).json({ success: false, message: 'Invalid TikTok URL' });

        const BASE_API = process.env.BACKEND_API
        const apiUrl = `${BASE_API}/api/?url=${encodeURIComponent(tiktokUrl)}`;
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://www.tiktok.com/'
            },
            timeout: 30000
        });

        const data = response.data;
        if (!data || data.code !== 0) {
            return res.status(400).json({ success: false, message: data.msg || 'Failed to fetch TikTok data' });
        }

        const videoId = data.data?.id || 'unknown_id';
        const username = data.data?.author?.unique_id || data.data?.author?.nickname || 'unknown_user';
        const hasVideo = data.data?.play;
        const hasImages = Array.isArray(data.data?.images) && data.data.images.length > 0;
        const coverUrl = data.data?.cover || data.data?.video?.cover || '';

        const result = {
            success: true,
            data: {
                id: videoId,
                author: {
                    unique_id: username,
                    nickname: data.data?.author?.nickname || username
                },
                video: hasVideo ? {
                    play: data.data.play,
                    filename: generateFilename(username, videoId, 'video')
                } : null,
                images: hasImages ? data.data.images.map((img, idx) => ({
                    url: typeof img === 'string' ? img : img.url || img,
                    filename: generateFilename(username, videoId, 'image', idx + 1)
                })) : [],
                cover: coverUrl ? { url: coverUrl, filename: generateFilename(username, videoId, 'thumbnail') } : null
            }
        };

        if (!hasVideo && !hasImages && !coverUrl) {
            return res.status(400).json({ success: false, message: 'No downloadable content found' });
        }

        res.json(result);

    } catch (error) {
        console.error('Error fetching TikTok data:', error.message);
        if (error.response) return res.status(error.response.status).json({ success: false, message: 'Tikwm API unavailable' });
        if (error.code === 'ECONNABORTED') return res.status(408).json({ success: false, message: 'Request timeout' });
        res.status(500).json({ success: false, message: 'An error occurred while processing your request' });
    }
});

// Proxy endpoint for downloads
app.get('/api/proxy', async (req, res) => {
    try {
        const fileUrl = req.query.url;
        const filename = req.query.filename || 'download';
        if (!fileUrl) return res.status(400).json({ success: false, message: 'Please provide a file URL' });

        const agent = new https.Agent({ keepAlive: true });
        try { new URL(fileUrl); } catch (e) { return res.status(400).json({ success: false, message: 'Invalid URL' }); }

        https.get(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://www.tiktok.com/',
                'Range': 'bytes=0-'
            },
            agent
        }, (fileStream) => {
            const contentType = fileStream.headers?.['content-type'] || 'application/octet-stream';
            const contentLength = fileStream.headers?.['content-length'];

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (contentLength) res.setHeader('Content-Length', contentLength);

            pipeline(fileStream, res, (err) => {
                if (err && !res.headersSent) res.status(500).json({ success: false, message: 'Streaming error' });
            });
        }).on('error', (err) => {
            res.status(500).json({ success: false, message: 'Failed to fetch the file' });
        });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to download file' });
    }
});

// Start server
const server = app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
server.timeout = 3600000;
server.keepAliveTimeout = 3600000;
