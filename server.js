const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Inicializace Express a HTTP serveru
const app = express();
const server = http.createServer(app);

// Inicializace Socket.io
const io = new Server(server);

// Servírování statických souborů z /public
app.use(express.static(path.join(__dirname, 'public')));

// API – otázky
const questions = require('./server/data/questions.json');
app.get('/api/questions', (req, res) => {
  res.json(questions);
});

// Základní route – vrátí index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io – lobby a herní logika
const setupSocket = require('./server/socketHandler');
setupSocket(io);

// Spuštění serveru
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});
