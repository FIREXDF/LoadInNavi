const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const os = require('os');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR_MUSIC = process.env.DOWNLOAD_DIR_MUSIC || './music';

const YTMusic = require('ytmusic-api');
const ytmusic = new YTMusic();

// Spotify API Setup
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Helper to get Spotify Token
async function ensureSpotifyToken() {
    try {
        console.log('[Debug] Requesting Spotify Access Token...');
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log('[Debug] Spotify access token acquired successfully.');
        return true;
    } catch (err) {
        console.error('[Error] Failed to retrieve Spotify access token:', err.message);
        if (err.body) console.error('Spotify Error Body:', err.body);
        return false;
    }
}

// Initial Token Fetch
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    ensureSpotifyToken();
    setInterval(ensureSpotifyToken, 3500 * 1000); // 1 hour approx
}

// Helper: Levenshtein Distance for string similarity
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

// Helper: Similarity Score (0 to 1)
function getSimilarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;
    return (longer.length - levenshtein(s1, s2)) / longer.length;
}

// Helper: Download file using fetch
async function downloadFile(url, destPath) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));
}

// Helper: Get server local IP
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Helper: Get user-specific download directory
function getUserDownloadDir(baseDir, username) {
    const userDir = path.join(baseDir, 'Users', username || 'default');
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        console.log(`[Info] Created user directory: ${userDir}`);
    }
    return userDir;
}

// Helper: Send SSE event
function sendSSE(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// SSE Download Endpoint
app.post('/download-stream', async (req, res) => {
    const { url, type, title, channelName, username } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    const userDir = getUserDownloadDir(DOWNLOAD_DIR_MUSIC, username);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`\n--- SSE Request: ${title || 'No Title'} [${type}] ---`);
    console.log(`URL: ${url}`);
    if (channelName) console.log(`Channel: ${channelName}`);
    if (username) console.log(`User: ${username}`);

    // Send initial event
    sendSSE(res, 'status', { status: 'request_received', message: 'Request received' });

    try {
        // Ensure Token if needed
        if (process.env.SPOTIFY_CLIENT_ID && !spotifyApi.getAccessToken()) {
            await ensureSpotifyToken();
        }

        let downloadDir = userDir;
        let finalUrl = url;
        let spotifyMeta = null;
        let shouldUseFfmpegMerge = false;

        // --- YOUTUBE NATIVE MODE ---
        if (type === 'youtube' && channelName) {
            console.log('[YouTube Native] Using video thumbnail and channel name as artist');
            sendSSE(res, 'status', { status: 'downloading', message: 'Downloading with YouTube metadata...' });
            
            const absDownloadDir = path.resolve(downloadDir);
            if (!fs.existsSync(absDownloadDir)) {
                fs.mkdirSync(absDownloadDir, { recursive: true });
            }

            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim();
            const tempAudio = path.join(absDownloadDir, `temp_${Date.now()}.mp3`);
            const finalPath = path.join(absDownloadDir, `${safeTitle}.mp3`);

            const cmd = `yt-dlp "${url}" -o "${tempAudio}" --no-playlist -x --audio-format mp3 --audio-quality 0 --embed-thumbnail --add-metadata`;
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    sendSSE(res, 'status', { status: 'error', message: 'Download failed', error: error.message });
                    return res.end();
                }

                if (!fs.existsSync(tempAudio)) {
                    console.error('[Error] Temp audio file not found:', tempAudio);
                    sendSSE(res, 'status', { status: 'error', message: 'Audio file not found' });
                    return res.end();
                }

                const ffmpegCmd = `ffmpeg -y -i "${tempAudio}" -c copy -id3v2_version 3 -metadata artist="${channelName.replace(/"/g, '\\"')}" "${finalPath}"`;
                
                exec(ffmpegCmd, (ffErr, ffOut, ffStderr) => {
                    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch(e){}

                    if (ffErr) {
                        console.error('ffmpeg error:', ffErr);
                        sendSSE(res, 'status', { status: 'error', message: 'Metadata override failed' });
                        return res.end();
                    }
                    
                    console.log('Success! Saved to:', finalPath);
                    sendSSE(res, 'status', { 
                        status: 'complete', 
                        message: 'Download complete',
                        path: finalPath,
                        meta: { title: title, artist: channelName }
                    });
                    res.end();
                });
            });
            
            return;
        }

        // --- SPOTIFY SEARCH ---
        if (type === 'music') {
            const token = spotifyApi.getAccessToken();
            if (title && token) {
                try {
                    let cleanTitle = title.split('|')[0]; 
                    cleanTitle = cleanTitle.replace(/[\(\[\{].*?[\)\]\}]/g, '')
                                          .replace(/official video|lyrics|audio|mv|music video|hd|4k|ncs|copyright free|music/gi, '')
                                          .replace(/-/g, ' ')
                                          .replace(/\s+/g, ' ')
                                          .trim();
                    
                    console.log(`[Debug] Spotify Search: "${cleanTitle}"`);
                    const searchRes = await spotifyApi.searchTracks(cleanTitle, { limit: 1 });

                    if (searchRes.body.tracks.items.length > 0) {
                        const track = searchRes.body.tracks.items[0];
                        const foundName = `${track.artists.map(a => a.name).join(', ')} - ${track.name}`;
                        
                        const spotifyScore = getSimilarity(cleanTitle.toLowerCase(), foundName.toLowerCase());
                        console.log(`[Debug] Spotify Match: "${foundName}" (Score: ${spotifyScore.toFixed(2)})`);

                        if (spotifyScore < 0.5) {
                             console.log(`[Debug] Spotify match is too different from query (Score: ${spotifyScore.toFixed(2)}). Ignoring Spotify Metadata.`);
                             spotifyMeta = null;
                             
                             // If we have a channel name, switch to YouTube Native mode
                             if (channelName) {
                                 console.log(`[Debug] Switching to YouTube Native mode with channel: ${channelName}`);
                                 sendSSE(res, 'status', { status: 'downloading', message: 'Using YouTube metadata...' });
                                 
                                 const absDownloadDir = path.resolve(downloadDir);
                                 if (!fs.existsSync(absDownloadDir)) {
                                     fs.mkdirSync(absDownloadDir, { recursive: true });
                                 }

                                 const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim();
                                 const tempAudio = path.join(absDownloadDir, `temp_${Date.now()}.mp3`);
                                 const finalPath = path.join(absDownloadDir, `${safeTitle}.mp3`);

                                 const cmd = `yt-dlp "${url}" -o "${tempAudio}" --no-playlist -x --audio-format mp3 --audio-quality 0 --embed-thumbnail --add-metadata`;
                                 
                                 exec(cmd, (error, stdout, stderr) => {
                                     if (error) {
                                         console.error('yt-dlp error:', error);
                                         sendSSE(res, 'status', { status: 'error', message: 'Download failed', error: error.message });
                                         return res.end();
                                     }

                                     if (!fs.existsSync(tempAudio)) {
                                         console.error('[Error] Temp audio file not found:', tempAudio);
                                         sendSSE(res, 'status', { status: 'error', message: 'Audio file not found' });
                                         return res.end();
                                     }

                                     const ffmpegCmd = `ffmpeg -y -i "${tempAudio}" -c copy -id3v2_version 3 -metadata artist="${channelName.replace(/"/g, '\\"')}" "${finalPath}"`;
                                     
                                     exec(ffmpegCmd, (ffErr, ffOut, ffStderr) => {
                                         try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch(e){}

                                         if (ffErr) {
                                             console.error('ffmpeg error:', ffErr);
                                             sendSSE(res, 'status', { status: 'error', message: 'Metadata override failed' });
                                             return res.end();
                                         }
                                         
                                         console.log('Success! Saved to:', finalPath);
                                         sendSSE(res, 'status', { 
                                             status: 'complete', 
                                             message: 'Download complete',
                                             path: finalPath,
                                             meta: { title: title, artist: channelName }
                                         });
                                         res.end();
                                     });
                                 });
                                 
                                 return; // Exit early
                             }
                         } else {
                            spotifyMeta = {
                                title: track.name,
                                artist: track.artists.map(a => a.name).join(', '),
                                album: track.album.name,
                                date: track.album.release_date,
                                cover: track.album.images[0]?.url,
                                isrc: track.external_ids?.isrc
                            };
                            
                            sendSSE(res, 'status', { status: 'downloading', message: 'Searching YouTube Music...' });
                            
                            try {
                                console.log(`[Debug] Searching YouTube Music API...`);
                                await ytmusic.initialize();
                                const musicResults = await ytmusic.search(`${spotifyMeta.artist} ${spotifyMeta.title}`);
                                
                                const songs = musicResults.filter(item => item.type === 'SONG');
                                console.log('[Debug] Found Songs:', songs.map(s => `${s.name} by ${Array.isArray(s.artist) ? s.artist.map(a => a.name).join(', ') : s.artist.name}`).join(' | '));

                                let bestMatch = null;
                                let bestScore = 0;

                                const targetTitle = spotifyMeta.title.toLowerCase();
                                
                                for (const song of songs) {
                                    const score = getSimilarity(targetTitle, song.name.toLowerCase());
                                    if (score > bestScore) {
                                        bestScore = score;
                                        bestMatch = song;
                                    }
                                }

                                console.log(`[Debug] Best YTMusic Match: "${bestMatch ? bestMatch.name : 'None'}" (Score: ${bestScore.toFixed(2)})`);

                                if (bestMatch && bestScore > 0.5) {
                                    finalUrl = `https://music.youtube.com/watch?v=${bestMatch.videoId}`;
                                    console.log(`[Debug] Selected via Similarity: ${bestMatch.name} (${finalUrl})`);
                                } else {
                                    console.log(`[Debug] No close match in YTMusic (Best score: ${bestScore.toFixed(2)}). Fallback to original video Audio.`);
                                    finalUrl = url; 
                                }
                            } catch (ytmErr) {
                                console.error('[Error] YTMusic API failed, falling back:', ytmErr.message);
                                finalUrl = url;
                            }
                            
                            shouldUseFfmpegMerge = true;
                        }

                    } else {
                        console.log('[Debug] No Spotify match.');
                    }
                } catch (e) {
                    console.error('[Error] Spotify Search:', e.message);
                }
            } else {
                console.log('[Debug] Skipping Spotify (Missing Title or Token)');
            }
        }

        // --- EXECUTION ---
        if (shouldUseFfmpegMerge && spotifyMeta) {
            sendSSE(res, 'status', { status: 'downloading', message: 'Downloading audio and cover art...' });
            
            const absDownloadDir = path.resolve(downloadDir);
            
            if (!fs.existsSync(absDownloadDir)) {
                fs.mkdirSync(absDownloadDir, { recursive: true });
            }

            const safeTitle = `${spotifyMeta.artist} - ${spotifyMeta.title}`.replace(/[<>:"/\\|?*]/g, '');
            const tempAudio = path.join(absDownloadDir, `temp_${Date.now()}.mp3`);
            const tempCover = path.join(absDownloadDir, `temp_${Date.now()}.jpg`);
            const finalPath = path.join(absDownloadDir, `${safeTitle}.mp3`);

            console.log('[Step 1/3] Downloading Cover Art...');
            await downloadFile(spotifyMeta.cover, tempCover);

            console.log('[Step 2/3] Downloading Audio (yt-dlp)...');
            const cmd = `yt-dlp "${finalUrl}" -o "${tempAudio}" --no-playlist -x --audio-format mp3 --audio-quality 0`;
            
            exec(cmd, async (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    try { if (fs.existsSync(tempCover)) fs.unlinkSync(tempCover); } catch(e){}
                    sendSSE(res, 'status', { status: 'error', message: 'Download failed', error: error.message });
                    return res.end();
                }
                
                console.log('[Debug] yt-dlp stdout:', stdout);

                if (!fs.existsSync(tempAudio)) {
                    console.error('[Error] Temp audio file not found after yt-dlp:', tempAudio);
                    sendSSE(res, 'status', { status: 'error', message: 'Audio download verification failed' });
                    return res.end();
                }

                console.log('[Step 3/3] Embedding Metadata & Cover (ffmpeg)...');
                
                const ffmpegCmd = `ffmpeg -y -i "${tempAudio}" -i "${tempCover}" -map 0 -map 1 -c copy -id3v2_version 3 ` +
                    `-metadata title="${spotifyMeta.title.replace(/"/g, '\\"')}" ` +
                    `-metadata artist="${spotifyMeta.artist.replace(/"/g, '\\"')}" ` +
                    `-metadata album="${spotifyMeta.album.replace(/"/g, '\\"')}" ` +
                    `-metadata date="${spotifyMeta.date}" ` +
                    `-metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "${finalPath}"`;

                exec(ffmpegCmd, (ffErr, ffOut, ffStderr) => {
                    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch(e){}
                    try { if (fs.existsSync(tempCover)) fs.unlinkSync(tempCover); } catch(e){}

                    if (ffErr) {
                        console.error('ffmpeg error:', ffErr);
                        sendSSE(res, 'status', { status: 'error', message: 'Metadata embedding failed' });
                        return res.end();
                    }
                    
                    console.log('Success! Saved to:', finalPath);
                    sendSSE(res, 'status', { 
                        status: 'complete', 
                        message: 'Download complete',
                        path: finalPath,
                        meta: spotifyMeta
                    });
                    res.end();
                });
            });

        } else {
            // Simple Flow
            sendSSE(res, 'status', { status: 'downloading', message: 'Downloading...' });
            
            const outputTemplate = '%(title)s.%(ext)s';
            const outputPath = path.join(downloadDir, outputTemplate);
            
            let cmd = `yt-dlp "${finalUrl}" -o "${outputPath}" --no-playlist -x --audio-format mp3 --audio-quality 0 --add-metadata --embed-thumbnail`;
            
            console.log(`[Debug] Executing Simple Download: ${cmd}`);
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    sendSSE(res, 'status', { status: 'error', message: 'Download failed', error: error.message });
                    return res.end();
                }
                sendSSE(res, 'status', { 
                    status: 'complete', 
                    message: 'Download complete',
                    meta: 'Simple Download'
                });
                res.end();
            });
        }

    } catch (error) {
        console.error('Handler Critical Error:', error);
        sendSSE(res, 'status', { status: 'error', message: 'Internal server error', error: error.message });
        res.end();
    }
});

// Original POST endpoint (kept for compatibility)
app.post('/download', async (req, res) => {
    const { url, type, title, channelName } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    console.log(`\n--- New Request: ${title || 'No Title'} [${type}] ---`);
    console.log(`URL: ${url}`);
    if (channelName) console.log(`Channel: ${channelName}`);

    try {
        // Ensure Token if needed
        if (process.env.SPOTIFY_CLIENT_ID && !spotifyApi.getAccessToken()) {
            await ensureSpotifyToken();
        }

        let downloadDir = DOWNLOAD_DIR_MUSIC;
        let finalUrl = url;
        let spotifyMeta = null;
        let shouldUseFfmpegMerge = false;

        // --- YOUTUBE NATIVE MODE ---
        if (type === 'youtube' && channelName) {
            console.log('[YouTube Native] Using video thumbnail and channel name as artist');
            
            const absDownloadDir = path.resolve(downloadDir);
            if (!fs.existsSync(absDownloadDir)) {
                fs.mkdirSync(absDownloadDir, { recursive: true });
            }

            // Clean title for filename
            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim();
            const tempAudio = path.join(absDownloadDir, `temp_${Date.now()}.mp3`);
            const finalPath = path.join(absDownloadDir, `${safeTitle}.mp3`);

            console.log('[Step 1/2] Downloading with yt-dlp (thumbnail + metadata)...');
            
            // Download with embedded thumbnail and metadata
            const cmd = `yt-dlp "${url}" -o "${tempAudio}" --no-playlist -x --audio-format mp3 --audio-quality 0 --embed-thumbnail --add-metadata`;
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    return res.status(500).json({ error: 'Download failed' });
                }

                console.log('[Debug] yt-dlp stdout:', stdout);

                if (!fs.existsSync(tempAudio)) {
                    console.error('[Error] Temp audio file not found:', tempAudio);
                    return res.status(500).json({ error: 'Audio download verification failed' });
                }

                console.log('[Step 2/2] Overriding artist metadata with channel name...');
                
                // Use ffmpeg to override artist metadata
                const ffmpegCmd = `ffmpeg -y -i "${tempAudio}" -c copy -id3v2_version 3 -metadata artist="${channelName.replace(/"/g, '\\"')}" "${finalPath}"`;
                
                exec(ffmpegCmd, (ffErr, ffOut, ffStderr) => {
                    // Cleanup temp
                    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch(e){}

                    if (ffErr) {
                        console.error('ffmpeg error:', ffErr);
                        return res.status(500).json({ error: 'Metadata override failed' });
                    }
                    
                    console.log('Success! Saved to:', finalPath);
                    res.json({ 
                        message: 'Success', 
                        path: finalPath, 
                        meta: { title: title, artist: channelName } 
                    });
                });
            });
            
            return; // Exit early for YouTube Native mode
        }

        // --- SPOTIFY SEARCH ---
        // --- SPOTIFY SEARCH ---
        if (type === 'music') {
            const token = spotifyApi.getAccessToken();
            if (title && token) {
                try {
                    // Improved Cleaning:
                    // 1. Split by '|' to remove common suffixes like "| Lyrics" or "| NCS"
                    // 2. Remove brackets () [] {}
                    // 3. Remove blacklist words
                    let cleanTitle = title.split('|')[0]; 
                    cleanTitle = cleanTitle.replace(/[\(\[\{].*?[\)\]\}]/g, '')
                                          .replace(/official video|lyrics|audio|mv|music video|hd|4k|ncs|copyright free|music/gi, '')
                                          .replace(/-/g, ' ')
                                          .replace(/\s+/g, ' ') // collapse multiple spaces
                                          .trim();
                    
                    console.log(`[Debug] Spotify Search: "${cleanTitle}"`);
                    const searchRes = await spotifyApi.searchTracks(cleanTitle, { limit: 1 });

                    if (searchRes.body.tracks.items.length > 0) {
                        const track = searchRes.body.tracks.items[0];
                        const foundName = `${track.artists.map(a => a.name).join(', ')} - ${track.name}`;
                        
                        // VALIDATION: Check if Spotify result actually matches the search query
                        // This prevents "LFZ - Popsicle" -> "Social Media Jailhouse Blues"
                        const spotifyScore = getSimilarity(cleanTitle.toLowerCase(), foundName.toLowerCase());
                        console.log(`[Debug] Spotify Match: "${foundName}" (Score: ${spotifyScore.toFixed(2)})`);

                        if (spotifyScore < 0.5) { // Threshold to ensure Spotify result is relevant
                             console.log(`[Debug] Spotify match is too different from query (Score: ${spotifyScore.toFixed(2)}). Ignoring Spotify Metadata.`);
                             spotifyMeta = null;
                        } else {
                            spotifyMeta = {
                                title: track.name,
                                artist: track.artists.map(a => a.name).join(', '),
                                album: track.album.name,
                                date: track.album.release_date,
                                cover: track.album.images[0]?.url, // High res cover
                                isrc: track.external_ids?.isrc
                            };
                            
                            // STRATEGY: Use YouTube Music API to find explicit "SONG" type (Art Track)
                            try {
                                console.log(`[Debug] Searching YouTube Music API...`);
                                await ytmusic.initialize(); // Ensure initialized
                                const musicResults = await ytmusic.search(`${spotifyMeta.artist} ${spotifyMeta.title}`);
                                
                                const songs = musicResults.filter(item => item.type === 'SONG');
                                console.log('[Debug] Found Songs:', songs.map(s => `${s.name} by ${Array.isArray(s.artist) ? s.artist.map(a => a.name).join(', ') : s.artist.name}`).join(' | '));

                                // Find best match using Fuzzy Search
                                let bestMatch = null;
                                let bestScore = 0;

                                const targetTitle = spotifyMeta.title.toLowerCase();
                                
                                for (const song of songs) {
                                    const score = getSimilarity(targetTitle, song.name.toLowerCase());
                                    if (score > bestScore) {
                                        bestScore = score;
                                        bestMatch = song;
                                    }
                                }

                                console.log(`[Debug] Best YTMusic Match: "${bestMatch ? bestMatch.name : 'None'}" (Score: ${bestScore.toFixed(2)})`);

                                // Threshold: 0.5 (50% similarity) to consider it a valid match
                                if (bestMatch && bestScore > 0.5) {
                                    finalUrl = `https://music.youtube.com/watch?v=${bestMatch.videoId}`;
                                    console.log(`[Debug] Selected via Similarity: ${bestMatch.name} (${finalUrl})`);
                                } else {
                                    console.log(`[Debug] No close match in YTMusic (Best score: ${bestScore.toFixed(2)}). Fallback to original video Audio.`);
                                    finalUrl = url; 
                                }
                            } catch (ytmErr) {
                                console.error('[Error] YTMusic API failed, falling back:', ytmErr.message);
                                finalUrl = url; // Fallback on error too
                            }
                            
                            shouldUseFfmpegMerge = true;
                        }

                    } else {
                        console.log('[Debug] No Spotify match.');
                    }
                } catch (e) {
                    console.error('[Error] Spotify Search:', e.message);
                }
            } else {
                console.log('[Debug] Skipping Spotify (Missing Title or Token)');
            }
        }

        // --- EXECUTION ---
        if (shouldUseFfmpegMerge && spotifyMeta) {
            // Complex Flow: Download Audio -> Download Cover -> Merge with FFmpeg
            // Ensure downloadDir is absolute to avoid FFmpeg/yt-dlp confusion
            const absDownloadDir = path.resolve(downloadDir);
            
            // Create dir if not exists
            if (!fs.existsSync(absDownloadDir)) {
                fs.mkdirSync(absDownloadDir, { recursive: true });
            }

            const safeTitle = `${spotifyMeta.artist} - ${spotifyMeta.title}`.replace(/[<>:"/\\|?*]/g, '');
            const tempAudio = path.join(absDownloadDir, `temp_${Date.now()}.mp3`);
            const tempCover = path.join(absDownloadDir, `temp_${Date.now()}.jpg`);
            const finalPath = path.join(absDownloadDir, `${safeTitle}.mp3`);

            console.log('[Step 1/3] Downloading Cover Art...');
            await downloadFile(spotifyMeta.cover, tempCover);

            console.log('[Step 2/3] Downloading Audio (yt-dlp)...');
            // Download raw audio, no metadata, to temp file
            const cmd = `yt-dlp "${finalUrl}" -o "${tempAudio}" --no-playlist -x --audio-format mp3 --audio-quality 0`;
            
            console.log(`[Debug] Executing Smart Download: ${cmd}`);

            exec(cmd, async (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    try { if (fs.existsSync(tempCover)) fs.unlinkSync(tempCover); } catch(e){}
                    return res.status(500).json({ error: 'Download failed' });
                }
                
                console.log('[Debug] yt-dlp stdout:', stdout);

                if (!fs.existsSync(tempAudio)) {
                    console.error('[Error] Temp audio file not found after yt-dlp:', tempAudio);
                    return res.status(500).json({ error: 'Audio download verification failed' });
                }

                console.log('[Step 3/3] Embedding Metadata & Cover (ffmpeg)...');
                
                // Construct FFmpeg command
                const ffmpegCmd = `ffmpeg -y -i "${tempAudio}" -i "${tempCover}" -map 0 -map 1 -c copy -id3v2_version 3 ` +
                    `-metadata title="${spotifyMeta.title.replace(/"/g, '\\"')}" ` +
                    `-metadata artist="${spotifyMeta.artist.replace(/"/g, '\\"')}" ` +
                    `-metadata album="${spotifyMeta.album.replace(/"/g, '\\"')}" ` +
                    `-metadata date="${spotifyMeta.date}" ` +
                    `-metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "${finalPath}"`;

                exec(ffmpegCmd, (ffErr, ffOut, ffStderr) => {
                    // Cleanup temps
                    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch(e){}
                    try { if (fs.existsSync(tempCover)) fs.unlinkSync(tempCover); } catch(e){}

                    if (ffErr) {
                        console.error('ffmpeg error:', ffErr);
                        return res.status(500).json({ error: 'Metadata embedding failed' });
                    }
                    
                    console.log('Success! Saved to:', finalPath);
                    res.json({ message: 'Success', path: finalPath, meta: spotifyMeta });
                });
            });

        } else {
            // Simple Flow: Just yt-dlp
            const outputTemplate = '%(title)s.%(ext)s';
            const outputPath = path.join(downloadDir, outputTemplate);
            
            let cmd = `yt-dlp "${finalUrl}" -o "${outputPath}" --no-playlist -x --audio-format mp3 --audio-quality 0 --add-metadata --embed-thumbnail`;
            
            console.log(`[Debug] Executing Simple Download: ${cmd}`);
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    return res.status(500).json({ error: 'Download failed' });
                }
                res.json({ message: 'Success', meta: 'Simple Download' });
            });
        }

    } catch (error) {
        console.error('Handler Critical Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/download', async (req, res) => {
    const { url, type, title, channelName, username } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    const userDir = getUserDownloadDir(DOWNLOAD_DIR_MUSIC, username);

    console.log(`\n--- Download Request: ${title || 'No Title'} [${type}] ---`);
    console.log(`URL: ${url}`);
    if (channelName) console.log(`Channel: ${channelName}`);
    if (username) console.log(`User: ${username}`);
    console.log(`Save to: ${userDir}`);

    try {
        if (process.env.SPOTIFY_CLIENT_ID && !spotifyApi.getAccessToken()) {
            await ensureSpotifyToken();
        }

        let downloadDir = userDir;
        let finalUrl = url;
        let spotifyMeta = null;

        if (type === 'youtube' && channelName) {
            console.log('[YouTube Native] Using video thumbnail and channel name as artist');
            
            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
            const absDownloadDir = path.resolve(downloadDir);
            const tempAudio = path.join(absDownloadDir, `${safeTitle}_temp.mp3`);
            const finalPath = path.join(absDownloadDir, `${safeTitle}.mp3`);

            const cmd = `yt-dlp "${url}" -o "${tempAudio}" --no-playlist -x --audio-format mp3 --audio-quality 0 --embed-thumbnail --add-metadata`;
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('yt-dlp error:', error);
                    return res.status(500).json({ error: 'Download failed', message: error.message });
                }

                const ffmpegCmd = `ffmpeg -y -i "${tempAudio}" -c copy -id3v2_version 3 -metadata artist="${channelName.replace(/"/g, '\\"')}" "${finalPath}"`;
                
                exec(ffmpegCmd, (ffErr, ffOut, ffStderr) => {
                    try { if (fs.existsSync(tempAudio)) fs.unlinkSync(tempAudio); } catch(e){}

                    if (ffErr) {
                        console.error('ffmpeg error:', ffErr);
                        return res.status(500).json({ error: 'Metadata tagging failed' });
                    }

                    console.log(`[YouTube Native] Success: ${finalPath}`);
                    res.json({
                        message: 'Download complete',
                        path: finalPath,
                        meta: { title: title, artist: channelName }
                    });
                });
            });
            
            return;
        }

        if (type === 'music') {
            const token = spotifyApi.getAccessToken();
            if (title && token) {
                try {
                    let cleanTitle = title.split('|')[0]; 
                    cleanTitle = cleanTitle.replace(/[\(\[\{].*?[\)\]\}]/g, '')
                                          .replace(/official.*?video/gi, '')
                                          .replace(/official.*?audio/gi, '')
                                          .replace(/lyrics?/gi, '')
                                          .replace(/\s+/g, ' ')
                                          .trim();
                    
                    console.log(`[Debug] Spotify Search: "${cleanTitle}"`);
                    const searchRes = await spotifyApi.searchTracks(cleanTitle, { limit: 1 });

                    if (searchRes.body.tracks.items.length > 0) {
                        const track = searchRes.body.tracks.items[0];
                        const foundName = `${track.artists.map(a => a.name).join(', ')} - ${track.name}`;
                        
                        const spotifyScore = getSimilarity(cleanTitle.toLowerCase(), foundName.toLowerCase());
                        console.log(`[Debug] Spotify Match: "${foundName}" (Score: ${spotifyScore.toFixed(2)})`);

                        if (spotifyScore < 0.5) {
                             console.log(`[Debug] Spotify match too different (Score: ${spotifyScore.toFixed(2)}). Ignoring Spotify Metadata.`);
                             spotifyMeta = null;
                        } else {
                            spotifyMeta = {
                                title: track.name,
                                artist: track.artists.map(a => a.name).join(', '),
                                album: track.album.name,
                                albumArt: track.album.images[0]?.url || null,
                                releaseDate: track.album.release_date
                            };
                            console.log(`[Debug] Spotify Metadata: ${spotifyMeta.artist} - ${spotifyMeta.title}`);
                        }
                    } else {
                        console.log('[Debug] No Spotify results found.');
                    }
                } catch (err) {
                    console.error('[Error] Spotify search failed:', err.message);
                }
            }
        }

        let outputTemplate = '%(title)s.%(ext)s';
        if (spotifyMeta) {
            const safeArtist = spotifyMeta.artist.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
            const safeTitle = spotifyMeta.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
            outputTemplate = `${safeArtist} - ${safeTitle}.%(ext)s`;
        }

        const outputPath = path.join(downloadDir, outputTemplate);
        
        let cmd = `yt-dlp "${finalUrl}" -o "${outputPath}" --no-playlist -x --audio-format mp3 --audio-quality 0 --add-metadata --embed-thumbnail`;
        
        if (spotifyMeta) {
            const metaArgs = [
                `--parse-metadata "title:%(meta_title)s"`,
                `--replace-in-metadata "title" ".*" "${spotifyMeta.title.replace(/"/g, '\\"')}"`,
                `--replace-in-metadata "artist" ".*" "${spotifyMeta.artist.replace(/"/g, '\\"')}"`,
                `--replace-in-metadata "album" ".*" "${spotifyMeta.album.replace(/"/g, '\\"')}"`
            ];
            cmd += ' ' + metaArgs.join(' ');
        }

        console.log(`[Debug] Executing: ${cmd}`);
        
        exec(cmd, async (error, stdout, stderr) => {
            if (error) {
                console.error('yt-dlp error:', error);
                return res.status(500).json({ error: 'Download failed' });
            }

            if (spotifyMeta && spotifyMeta.albumArt) {
                const files = fs.readdirSync(downloadDir);
                const mp3File = files.find(f => f.endsWith('.mp3') && f.includes(spotifyMeta.title.substring(0, 20)));
                
                if (mp3File) {
                    const mp3Path = path.join(downloadDir, mp3File);
                    const coverPath = path.join(downloadDir, 'cover_temp.jpg');
                    
                    try {
                        await downloadFile(spotifyMeta.albumArt, coverPath);
                        const ffmpegCmd = `ffmpeg -y -i "${mp3Path}" -i "${coverPath}" -map 0:a -map 1:0 -c copy -id3v2_version 3 -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "${mp3Path}.tmp.mp3"`;
                        
                        exec(ffmpegCmd, (ffErr) => {
                            try { fs.unlinkSync(coverPath); } catch(e){}
                            if (!ffErr && fs.existsSync(`${mp3Path}.tmp.mp3`)) {
                                fs.renameSync(`${mp3Path}.tmp.mp3`, mp3Path);
                                console.log('[Debug] Album art embedded successfully');
                            }
                            res.json({ message: 'Success', meta: spotifyMeta });
                        });
                    } catch (err) {
                        console.error('[Error] Album art embedding failed:', err.message);
                        res.json({ message: 'Success', meta: spotifyMeta });
                    }
                } else {
                    res.json({ message: 'Success', meta: spotifyMeta });
                }
            } else {
                res.json({ message: 'Success', meta: spotifyMeta || 'Simple Download' });
            }
        });

    } catch (error) {
        console.error('Handler Critical Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint for Dokploy monitoring
app.get('/health', (req, res) => {
    const healthcheck = {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: 'LoadInNavi Backend',
        version: '5.0',
        nfs_mount: DOWNLOAD_DIR_MUSIC,
        spotify_configured: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
    };
    
    // Check if download directory is accessible
    try {
        fs.accessSync(DOWNLOAD_DIR_MUSIC, fs.constants.W_OK);
        healthcheck.storage_writable = true;
    } catch (err) {
        healthcheck.storage_writable = false;
        healthcheck.storage_error = err.message;
    }
    
    res.status(200).json(healthcheck);
});


const serverIP = getLocalIP();
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`Server running on port ${PORT}`);
    console.log(`VERSION 5.0 - Multi-user NFS Support`);
    console.log(`========================================`);
    console.log(`\n📡 Server IP: ${serverIP}`);
    console.log(`\n🔧 NFS Configuration:`);
    console.log(`   Add this IP to your QNAP NFS permissions:`);
    console.log(`   ${serverIP}`);
    console.log(`\n📁 Music will be saved to:`);
    console.log(`   ${DOWNLOAD_DIR_MUSIC}/Users/[username]/`);
    console.log(`\n========================================\n`);
});
