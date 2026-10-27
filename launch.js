const { spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');

console.log('====================================================');
console.log('             Starting LUMEN Hi-Fi System            ');
console.log('====================================================');

const serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], {
  cwd: __dirname,
  stdio: 'inherit'
});

// Poll until local server is up, then launch UI in browser / app window
function openBrowserWhenReady(retries = 30) {
  const req = http.get('http://localhost:3847/api/info', (res) => {
    console.log('\n[LUMEN] Server is online! Launching application...\n');
    
    // Attempt to open in Microsoft Edge app mode for native desktop window feel
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const fs = require('fs');
    const validEdge = edgePaths.find(p => fs.existsSync(p));

    if (validEdge) {
      exec(`"${validEdge}" --app="http://localhost:3847" --window-size=1280,840`, (err) => {
        if (err) {
          exec('start http://localhost:3847');
        }
      });
    } else {
      exec('start http://localhost:3847');
    }
  });

  req.on('error', () => {
    if (retries > 0) {
      setTimeout(() => openBrowserWhenReady(retries - 1), 300);
    } else {
      console.error('[LUMEN] Failed to reach local audio server on port 3847.');
    }
  });
}

openBrowserWhenReady();

// Handle graceful shutdown
process.on('SIGINT', () => {
  serverProcess.kill();
  process.exit(0);
});
