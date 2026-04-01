import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.listen(3002, () => console.log('Server on 3002'));
setInterval(() => {}, 1000000); // Keep alive
