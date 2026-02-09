// ==UserScript==
// @name         LoadInNavi
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Download YouTube videos/music to your server for Navidrome (Auto-Spotify Tagging)
// @author       You
// @match        https://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      YOUR_SERVER_IP

// MAKE SURE TO MATCH @connect AND "SERVER_IP".

(function() {
    'use strict';

    const CONFIG = {
        USERNAME: 'FIREXDF',
        SERVER_IP: 'YOUR_SERVER_IP',
        SERVER_PORT: '3002',
        get BASE_URL() {
            return `http://${this.SERVER_IP}:${this.SERVER_PORT}`;
        },
        get DOWNLOAD_URL() {
            return `${this.BASE_URL}/download`;
        },
        get DOWNLOAD_STREAM_URL() {
            return `${this.BASE_URL}/download-stream`;
        },
        get HEALTH_URL() {
            return `${this.BASE_URL}/health`;
        }
    };
    
    console.log('[LoadInNavi] Backend configured:', CONFIG.BASE_URL);
    console.log('[LoadInNavi] Username:', CONFIG.USERNAME);
    
    // Config style
    GM_addStyle(`
        #ln-download-btn {
            background-color: rgba(255, 255, 255, 0.1);
            color: #f1f1f1;
            border: none;
            border-radius: 18px;
            padding: 0 16px;
            height: 36px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            margin-left: 8px;
            display: flex;
            align-items: center;
            font-family: "Roboto", sans-serif;
            transition: background-color 0.2s;
            gap: 6px;
        }
        #ln-download-btn:hover {
            background-color: rgba(255, 255, 255, 0.2);
        }
        #ln-download-btn svg {
            width: 24px; 
            height: 24px;
            fill: currentColor;
        }
        .ln-menu {
            position: absolute;
            background: #282828; 
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            min-width: 250px;
            z-index: 9999;
            padding: 8px 0;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .ln-menu-item {
            padding: 0 16px;
            height: 48px;
            display: flex;
            align-items: center;
            cursor: pointer;
            color: var(--yt-spec-text-primary, white);
            font-family: "Roboto", sans-serif;
            font-size: 14px;
            gap: 16px;
        }
        .ln-menu-item:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }
        .ln-menu-icon {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ln-menu-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .ln-subtext {
            font-size: 12px;
            color: #aaa;
        }
        /* Toast Notification */
        .ln-toast {
            position: fixed;
            bottom: 24px;
            left: 24px;
            background: #282828;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            z-index: 10000;
            font-family: Roboto, sans-serif;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 12px;
            transform: translateY(100px);
            transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s;
            opacity: 0;
            border: 1px solid rgba(255,255,255,0.1);
            white-space: pre-line;
            max-width: 400px;
        }
        .ln-toast.show {
            transform: translateY(0);
            opacity: 1;
        }
    `);

    function createDownloadButton() {
        if (document.getElementById('ln-download-btn')) return;

        const actionsContainer = document.querySelector('#actions-inner #menu #top-level-buttons-computed') || 
                                 document.querySelector('#owner #subscribe-button') ||
                                 document.querySelector('.ytd-video-primary-info-renderer #top-level-buttons-computed');

        if (actionsContainer) {
            const btn = document.createElement('button');
            btn.id = 'ln-download-btn';
            // Use an SVG similar to a download icon, looking native
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
                    <path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-4.9z"></path>
                </svg>
                <span>LoadInNavi</span>
            `;
            btn.onclick = (e) => {
                e.stopPropagation();
                toggleMenu();
            };
            actionsContainer.parentNode.insertBefore(btn, actionsContainer.nextSibling); 
        }
    }

    function getKeyData() {
        let title = "";
        let channelName = "";
        
        const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer') || document.querySelector('#title h1');
        if (titleEl) title = titleEl.innerText;
        
        // Extract channel name
        const channelEl = document.querySelector('ytd-channel-name a') || 
                         document.querySelector('#owner #channel-name a') ||
                         document.querySelector('#upload-info #channel-name a');
        if (channelEl) channelName = channelEl.innerText.trim();
         
        return {
            url: window.location.href,
            title: title,
            channelName: channelName
        };
    }

    function toggleMenu() {
        const existing = document.querySelector('.ln-menu');
        if (existing) {
            existing.remove();
            return;
        }

        const btn = document.getElementById('ln-download-btn');
        if (!btn) return;
        const rect = btn.getBoundingClientRect();

        const menu = document.createElement('div');
        menu.className = 'ln-menu';
        
        menu.innerHTML = `
            <div class="ln-menu-item" id="ln-dl-music">
                <div class="ln-menu-icon" style="color:#1DB954">✨</div>
                <div class="ln-menu-text">
                    <span>Smart Music</span>
                    <span class="ln-subtext">Spotify Match & HQ Auto-Tag</span>
                </div>
            </div>
            <div class="ln-menu-item" id="ln-dl-youtube">
                <div class="ln-menu-icon" style="color:#ff0000">📺</div>
                <div class="ln-menu-text">
                    <span>YouTube Native</span>
                    <span class="ln-subtext">Video Thumbnail & Channel Name</span>
                </div>
            </div>
            <div class="ln-menu-item" id="ln-dl-simple">
                <div class="ln-menu-icon" style="color:#888">🎵</div>
                <div class="ln-menu-text">
                     <span>Simple MP3</span>
                     <span class="ln-subtext">Current Video Audio</span>
                </div>
            </div>
        `;

        menu.style.visibility = 'hidden';
        document.body.appendChild(menu);
        
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth;
        
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        
        let topPos;
        if (spaceBelow < menuHeight + 10 && spaceAbove > menuHeight + 10) {
            topPos = rect.top + scrollTop - menuHeight - 8;
        } else {
            topPos = rect.bottom + scrollTop + 8;
        }
        
        menu.style.top = `${topPos}px`;
        menu.style.left = `${rect.left + scrollLeft}px`;
        menu.style.visibility = 'visible';

        const closeHandler = (e) => {
             if (!menu.contains(e.target) && e.target.id !== 'ln-download-btn') {
                 menu.remove();
                 document.removeEventListener('click', closeHandler);
             }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);

        menu.querySelector('#ln-dl-music').onclick = () => {
            const data = getKeyData();
            sendDownloadRequest(data.url, 'music', data.title, data.channelName, CONFIG.USERNAME);
            menu.remove();
        };
        menu.querySelector('#ln-dl-youtube').onclick = () => {
            const data = getKeyData();
            sendDownloadRequest(data.url, 'youtube', data.title, data.channelName, CONFIG.USERNAME);
            menu.remove();
        };
        menu.querySelector('#ln-dl-simple').onclick = () => {
            const data = getKeyData();
            sendDownloadRequest(data.url, 'simple', data.title, data.channelName, CONFIG.USERNAME);
            menu.remove(); 
        };
    }

    function showToast(text, duration = 4000) {
        let toast = document.querySelector('.ln-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'ln-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = text;
        
        // Force reflow for animation
        void toast.offsetWidth;
        toast.classList.add('show');
        
        if (window.lnToastTimeout) clearTimeout(window.lnToastTimeout);
        window.lnToastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    function sendDownloadRequest(url, type, title, channelName, username) {
        // Determine mode name for toast
        let modeName = 'Simple MP3';
        if (type === 'music') modeName = 'Smart Music';
        if (type === 'youtube') modeName = 'YouTube Native';
        
        console.log('[LoadInNavi] Starting download:', { url, type, username, modeName });
        
        // Utiliser directement l'endpoint classique (plus fiable que SSE avec Tampermonkey)
        sendDownloadRequestFallback(url, type, title, channelName, modeName, username);
    }
    
    function processSSEData(data, modeName) {
        const lines = data.split('\n\n');
        
        lines.forEach(line => {
            if (line.trim() === '') return;
            
            // Parse SSE format: "event: status\ndata: {...}"
            const eventMatch = line.match(/event:\s*(\w+)/);
            const dataMatch = line.match(/data:\s*(.+)/);
            
            if (eventMatch && dataMatch) {
                const event = eventMatch[1];
                try {
                    const eventData = JSON.parse(dataMatch[1]);
                    handleSSEEvent(event, eventData, modeName);
                } catch (e) {
                    console.error('Failed to parse SSE data:', e);
                }
            }
        });
    }
    
    function handleSSEEvent(event, data, modeName) {
        console.log('[SSE Event]', event, data);
        
        if (event === 'status') {
            switch (data.status) {
                case 'request_received':
                    showToast(`⏳ ${modeName}: Request received...`, 30000);
                    break;
                    
                case 'downloading':
                    showToast(`⏳ ${modeName}: Downloading...`, 30000);
                    break;
                    
                case 'complete':
                    let msg = `✅ ${modeName}: Download complete!`;
                    
                    if (data.meta && data.meta.title) {
                        msg = `✅ ${modeName}\n📀 ${data.meta.artist} - ${data.meta.title}`;
                    }
                    
                    if (data.path) {
                        const fileName = data.path.split('\\').pop().split('/').pop();
                        msg += `\n💾 ${fileName}`;
                    }
                    
                    showToast(msg, 6000);
                    break;
                    
                case 'error':
                    showToast(`❌ ${modeName}: Error\n${data.message || 'Unknown error'}`, 5000);
                    break;
            }
        }
    }
    
    // Fallback to regular endpoint if SSE fails
    function sendDownloadRequestFallback(url, type, title, channelName, modeName, username) {
        showToast(`⏳ ${modeName}: Sending request...`, 30000);
        
        setTimeout(() => {
            showToast(`⏳ ${modeName}: Downloading...`, 30000);
        }, 500);
        
        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.DOWNLOAD_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ url, type, title, channelName, username }),
            onload: function(response) {
                if (response.status === 200) {
                    const json = JSON.parse(response.responseText);
                    let msg = `✅ ${modeName}: Download complete!`;
                    
                    if (json.meta && json.meta.title) {
                        msg = `✅ ${modeName}\n📀 ${json.meta.artist} - ${json.meta.title}`;
                    }
                    
                    if (json.path) {
                        const fileName = json.path.split('\\').pop().split('/').pop();
                        msg += `\n💾 ${fileName}`;
                    }
                    
                    showToast(msg, 6000);
                } else {
                    showToast(`❌ ${modeName}: Error\n${response.responseText}`, 5000);
                }
            },
            onerror: function(err) {
                 showToast(`❌ Connection Failed\nCheck if backend is running`, 5000);
            }
        });
    }

    const observer = new MutationObserver(() => {
        if (!document.getElementById('ln-download-btn') && window.location.href.includes('watch')) {
            createDownloadButton();
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });

})();
