<h1 align="center" id="title">LoadInNavi</h1>

<p align="center"><img src="https://files.catbox.moe/scdqhx.svg" alt="project-image"></p>

<p id="description">A userscript and a server to download easy any music you can find on YouTube for Navidrome. Compatible with Dokploy and Docker Compose.</p>

<h2>Project Screenshots:</h2>

<img src="https://files.catbox.moe/4lkjhx.png" alt="project-screenshot">

<img src="https://files.catbox.moe/ua2wy1.png" alt="project-screenshot">

<img src="https://files.catbox.moe/ul3e7e.png" alt="project-screenshot">

  
  
<h2>🧐 Features</h2>

Here're some of the project's best features:

*   Easy download on YouTube
*   Get automatically metadata from Spotify
*   Easy to use
*   Support multiple users
*   Auto-organize files by username
*   Don't download the video, he automaticaly try to download the music on YouTube Music (Only music not the video)

---

<h2>📁 NAS Folder Structure</h2>

<p><strong>Important:</strong> Your NAS must have the following folder structure:</p>

```
Music (Shared Folder)
└── Users/
    ├── your_username/
    │   ├── Artist - Song1.mp3
    │   ├── Artist - Song2.mp3
    │   └── ...
    └── another_user/
        └── ...
```

<p><strong>Setup on your NAS:</strong></p>

1. Create a shared folder named `Music` (or any name you prefer)
2. Inside `Music`, create a folder named `Users`
3. The application will automatically create user-specific folders (e.g., `Users/FIREXDF/`)

<p><strong>Shared Folder Name:</strong></p>

You can name your shared folder anything you want. Common names:
- `Music` (recommended)
- `Media`
- `Navidrome`
- `Audio`

Just make sure to use the same name in the NFS path when running the setup script.

<p><strong>Example path on QNAP:</strong></p>

```
# If your shared folder is called "Music":
/share/CACHEDEV1_DATA/Music/Users/your_username/

# If your shared folder is called "Media":
/share/CACHEDEV1_DATA/Media/Users/your_username/
```

---

<h2>🛠️ Installation</h2>

Choose your deployment method:

- **[Option 1: Dokploy](#-option-1-dokploy-recommended)** - Recommended for production with NAS
- **[Option 2: Docker Compose](#-option-2-docker-compose)** - For local development or self-hosted

---

<h3>📦 Option 1: Dokploy (Recommended)</h3>

<p><strong>Prerequisites:</strong></p>

- Dokploy server installed
- QNAP NAS with NFS enabled
- Spotify API credentials ([Get them here](https://developer.spotify.com/dashboard))

<h4>Step 1: Setup NAS (SSH to your Dokploy server)</h4>

```bash
# Download and run the NAS setup script
wget https://raw.githubusercontent.com/FIREXDF/LoadInNavi/main/setup-nas.sh
chmod +x setup-nas.sh
sudo ./setup-nas.sh
# Enter your QNAP IP when prompted
```

<h4>Step 2: Create a Project in Dokploy</h4>

1. Open Dokploy dashboard
2. Click **"Create Project"**
3. Project Name: `Navidrome`
4. Click **"Create"**

<h4>Step 3: Create a Service</h4>

1. Inside the `Navidrome` project, click **"Create Service"**
2. Select **"Compose"** (not Application)
3. Service Name: `LoadInNavi`
4. **Compose Type**: Select `Docker Compose`
5. Click **"Create"**

<h4>Step 4: Configure the Service</h4>

1. **Provider**: Select `Git`
2. **Repository**: `https://github.com/FIREXDF/LoadInNavi.git`
3. **Branch**: `main`
4. **Compose Path**: `docker-compose.yml`

<h4>Step 5: Add Environment Variables</h4>

In the service settings, add these environment variables:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

<p>Get your Spotify API keys at: <a href="https://developer.spotify.com/dashboard">developer.spotify.com/dashboard</a></p>

<h4>Step 6: Deploy</h4>

1. Click **"Deploy"**
2. Wait for the build to complete (2-3 minutes)
3. Check logs to verify deployment

<p><strong>Your service will be available at:</strong> `http://YOUR_SERVER_IP:3002`</p>

---

<h3>🐳 Option 2: Docker Compose</h3>

<p><strong>Prerequisites:</strong></p>

- Docker and Docker Compose installed
- Spotify API credentials ([Get them here](https://developer.spotify.com/dashboard))

<h4>Step 1: Clone the repository</h4>

```bash
git clone https://github.com/FIREXDF/LoadInNavi.git
cd LoadInNavi
```

<h4>Step 2: Configure environment variables</h4>

```bash
# Copy the example env file
cp .env.example backend/.env

# Edit backend/.env with your Spotify credentials
nano backend/.env
```

Add your Spotify credentials:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
PORT=3002
DOWNLOAD_DIR_MUSIC=/music
```

<h4>Step 3: Start the application</h4>

```bash
# Start with Docker Compose
docker-compose up -d

# Check logs
docker logs -f loadinnavi-backend
```

The application will be accessible on `http://localhost:3002`

<h4>Step 4: Verify installation</h4>

```bash
# Check health endpoint
curl http://localhost:3002/health

# Should return:
# {"status":"ok","uptime":123,"service":"LoadInNavi Backend",...}
```

---

<h2>🎨 Userscript Setup</h2>

<h3>Step 1: Install Tampermonkey</h3>

- Chrome: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/)
- Firefox: [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/)

<h3>Step 2: Install the LoadInNavi userscript</h3>

- Open `userscript/LoadInNavi.user.js` from this repository
- Copy the entire content
- In Tampermonkey: Create new script → Paste → Save

<h3>Step 3: Configure the userscript</h3>

Edit these lines in the userscript:

```javascript
const CONFIG = {
    USERNAME: 'your_username',        // ← Change this to your username
    SERVER_IP: 'YOUR_SERVER_IP',      // ← Your server IP (e.g., 192.168.1.100 or localhost)
    SERVER_PORT: '3002',              // ← Keep 3002
};
```

Also update the `@connect` directive (line 10):

```javascript
// @connect      YOUR_SERVER_IP  // ← Must match your SERVER_IP
```

<p><strong>Examples:</strong></p>

**For Dokploy deployment:**
```javascript
SERVER_IP: '192.168.1.100',  // Your Dokploy server IP
```

**For local Docker Compose:**
```javascript
SERVER_IP: 'localhost',  // Or 127.0.0.1
```

<h3>Step 4: Test it!</h3>

- Go to any YouTube video
- Click the LoadInNavi button (appears next to the video title)
- Select a download mode:
  - **Smart Music**: Spotify metadata + album art
  - **YouTube Native**: Video thumbnail + channel name
  - **Simple MP3**: Basic download
- Check your files:
  - **Dokploy**: `/mnt/qnap/music/Users/your_username/`
  - **Docker Compose**: `./downloads/music/Users/your_username/`

---

<h2>✅ Verification</h2>

<h3>Check server health</h3>

```bash
# For Dokploy
curl http://YOUR_SERVER_IP:3002/health

# For Docker Compose
curl http://localhost:3002/health
```

<h3>Check NAS mount (Dokploy only)</h3>

```bash
df -h | grep qnap
ls -la /mnt/qnap/music/Users/
```

<h3>Check logs</h3>

```bash
# For Dokploy (via Dokploy UI or SSH)
docker logs loadinnavi-backend

# For Docker Compose
docker logs -f loadinnavi-backend
```

---


<h2>🔧 Configuration</h2>

<h3>Environment Variables</h3>

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SPOTIFY_CLIENT_ID` | Spotify API Client ID | - | Yes |
| `SPOTIFY_CLIENT_SECRET` | Spotify API Client Secret | - | Yes |
| `PORT` | Server port | `3002` | No |
| `DOWNLOAD_DIR_MUSIC` | Music download directory | `/music` | No |

<h3>Userscript Configuration</h3>

| Variable | Description | Example |
|----------|-------------|---------|
| `USERNAME` | Your username for file organization | `FIREXDF` |
| `SERVER_IP` | Your server IP address | `192.168.1.100` or `localhost` |
| `SERVER_PORT` | Server port | `3002` |

---

<h2>🐛 Troubleshooting</h2>

<h3>Server not starting</h3>

```bash
# Check logs
docker logs loadinnavi-backend

# Verify environment variables
docker exec loadinnavi-backend env | grep SPOTIFY
```

<h3>Cannot connect from userscript</h3>

1. Verify `SERVER_IP` matches in userscript and `@connect` directive
2. Check server is accessible: `curl http://YOUR_SERVER_IP:3002/health`
3. Check browser console (F12) for errors

<h3>NAS mount issues (Dokploy)</h3>

```bash
# Check NFS mount
df -h | grep qnap

# Remount if needed
sudo mount -a

# Check permissions
ls -la /mnt/qnap/music
```

<h3>Spotify API not working</h3>

1. Verify credentials in environment variables
2. Check logs for Spotify errors
3. Ensure credentials are from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
4. Maybe Spotify API are down.

---

<h2>Project Structure</h2>

```
LoadInNavi/
├── backend/
│   ├── server.js           # Express server
│   ├── Dockerfile          # Docker image
│   ├── package.json        # Dependencies
│   └── .env               # Environment variables (create this)
├── userscript/
│   └── LoadInNavi.user.js # Tampermonkey script
├── docker-compose.yml      # Docker Compose config
├── setup-nas.sh           # NAS setup script
└── README.md              # This file
```

<h2>🙏 Credits</h2>

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube downloader
- [Spotify Web API](https://developer.spotify.com/documentation/web-api/) - Music metadata
- [FFmpeg](https://ffmpeg.org/) - Audio processing
- [Dokploy](https://dokploy.com/) - Deployment platform

---

<p align="center">⭐ Star this repo if you find it useful!</p>
