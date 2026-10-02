const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('<h1>Site Yekhdem - Bot is Live</h1>');
});

app.listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log('Live');
});
