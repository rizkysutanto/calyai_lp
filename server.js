const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Create emails table if it doesn't exist
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS emails (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Initialize database on startup
initializeDatabase();

// Function to serve video files with range support
function serveVideo(filePath, req, res) {
    fs.stat(filePath, (err, stats) => {
        if (err) {
            res.writeHead(404);
            res.end('Video not found');
            return;
        }

        const range = req.headers.range;
        const fileSize = stats.size;

        if (range) {
            // Parse Range header
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            // Create read stream for the requested range
            const file = fs.createReadStream(filePath, { start, end });

            // Set headers for partial content
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-cache'
            });

            file.pipe(res);
        } else {
            // Serve entire file
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache'
            });

            fs.createReadStream(filePath).pipe(res);
        }
    });
}

const server = http.createServer(async (req, res) => {
    // Handle CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // Handle email submission
    if (req.method === 'POST' && pathname === '/submit-email') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const email = data.email;
                
                // Validate email
                if (!email || !email.includes('@')) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid email address' }));
                    return;
                }
                
                // Insert email into database
                await pool.query(
                    'INSERT INTO emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
                    [email]
                );
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Email saved successfully!' }));
                
            } catch (error) {
                console.error('Error saving email:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Error saving email' }));
            }
        });
        return;
    }
    
    // Serve static files
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    
    // Get file extension
    const extname = path.extname(filePath).toLowerCase();
    
    // Special handling for video files
    if (extname === '.mp4') {
        serveVideo(filePath, req, res);
        return;
    }
    
    // Set content type based on file extension
    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject'
    };
    
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    // Check if file exists
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File not found, serve index.html for SPA routing
                fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
                    if (err) {
                        res.writeHead(500);
                        res.end('Server Error: Could not find index.html');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(content, 'utf8');
                    }
                });
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + err.message);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Server accessible at http://0.0.0.0:${PORT}`);
});
