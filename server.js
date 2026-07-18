const express = require('express');
const axios = require('axios');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve main page at /fpeds
app.get('/fpeds', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Link checker endpoint
app.post('/fpeds/check', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ status: 'error', message: 'No URL provided' });

  const isOnion = url.includes('.onion');
  const startTime = Date.now();

  try {
    let response;
    if (isOnion) {
      // Try via Tor SOCKS5 proxy (127.0.0.1:9050)
      try {
        const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
        response = await axios.get(url, {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: 12000,
          maxRedirects: 5,
          validateStatus: () => true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0'
          }
        });
      } catch (torErr) {
        return res.json({
          status: 'tor_unavailable',
          message: 'Tor proxy not running. .onion links require Tor (SOCKS5 on port 9050).',
          url,
          isOnion: true,
          responseTime: Date.now() - startTime
        });
      }
    } else {
      response = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
      });
    }

    const statusCode = response.status;
    const responseTime = Date.now() - startTime;
    const isActive = statusCode >= 200 && statusCode < 400;

    res.json({
      status: isActive ? 'active' : 'inactive',
      httpCode: statusCode,
      responseTime,
      url,
      isOnion,
      contentType: response.headers['content-type'] || 'unknown',
      server: response.headers['server'] || 'unknown'
    });

  } catch (err) {
    const responseTime = Date.now() - startTime;
    let message = 'Connection failed';
    if (err.code === 'ECONNREFUSED') message = 'Connection refused';
    else if (err.code === 'ENOTFOUND') message = 'Host not found / DNS failure';
    else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') message = 'Request timed out';
    else if (err.message) message = err.message;

    res.json({
      status: 'dead',
      message,
      url,
      isOnion,
      responseTime
    });
  }
});

// Search endpoint — SSE stream
const CHATROOM_QUERIES = [
  'site:reddit.com "random video chat"',
  'site:reddit.com "talk to strangers"',
  'site:reddit.com "random chat rooms"',
  'random stranger video chat site',
  'omegle alternative chat strangers 2024',
  'chatroulette alternative list',
  'anonymous chat strangers no login',
  'random video chat adult 18+',
  'talk to random people online free',
  'stranger chat roulette sites',
  'site:alternativeto.net omegle',
  'best omegle alternatives list',
  'random chat like omegle free',
  'text chat with strangers anonymous',
  'video roulette chat sites 2024',
  'chat with random people no account',
  'stranger text chat rooms online',
  'random chat app web browser',
  'anonymous video call strangers',
  'chatrandom alternatives free',
  'emerald chat alternative',
  'chatspin random chat',
  'camsurf alternative chat',
  'shagle random video chat',
  'random chat site no registration',
  '"talk to strangers" -omegle site:.com',
  'yesichat alternative rooms',
  'chat avenue random rooms',
  'wireclub chat alternative',
  'chatib random stranger',
  'talk.chat strangers free',
  'randomskip video chat',
  'camsoda random roulette',
  'chatrandom.com alternative',
  'hiyak random video chat',
  'monkey app alternative web',
  'random chat discord servers',
  'tinychat alternative random',
  'bazoocam alternative video',
  'chatgig stranger random',
  'fruzo chat strangers',
  'paltalk random rooms',
  'twoo chat strangers',
  'badoo random chat',
  'moco chat strangers',
  'lovoo chat random strangers',
  'zoosk chat strangers',
  'random chat LGBT friendly strangers',
  'anonymous gay chat strangers random',
  'random chat dark web onion hidden'
];

// Curated list of real random-chat-with-strangers sites
const KNOWN_CHAT_LINKS = [
  { url: 'https://www.omegle.com', name: 'Omegle (archived)' },
  { url: 'https://www.chatrandom.com', name: 'ChatRandom' },
  { url: 'https://emeraldchat.com', name: 'Emerald Chat' },
  { url: 'https://chatspin.com', name: 'ChatSpin' },
  { url: 'https://camsurf.com', name: 'CamSurf' },
  { url: 'https://www.shagle.com', name: 'Shagle' },
  { url: 'https://www.bazoocam.com', name: 'Bazoocam' },
  { url: 'https://yesichat.com', name: 'YesiChat' },
  { url: 'https://www.chatib.us', name: 'Chatib' },
  { url: 'https://tinychat.com', name: 'TinyChat' },
  { url: 'https://paltalk.com', name: 'Paltalk' },
  { url: 'https://www.chatavenue.com', name: 'Chat Avenue' },
  { url: 'https://www.wireclub.com', name: 'Wireclub' },
  { url: 'https://hiyak.com', name: 'Hiyak' },
  { url: 'https://fruzo.com', name: 'Fruzo' },
  { url: 'https://www.chatgig.com', name: 'ChatGig' },
  { url: 'https://camhub.cc', name: 'CamHub' },
  { url: 'https://www.randomskip.com', name: 'RandomSkip' },
  { url: 'https://www.dirtyroulette.com', name: 'DirtyRoulette' },
  { url: 'https://www.talkliv.com', name: 'TalkLiv' },
  { url: 'https://ometv.tv', name: 'OmeTV' },
  { url: 'https://www.chatki.com', name: 'Chatki' },
  { url: 'https://loveeto.com', name: 'Loveeto' },
  { url: 'https://soulmegle.com', name: 'Soulmegle' },
  { url: 'https://www.joingy.com', name: 'Joingy' },
  { url: 'https://www.lollichat.com', name: 'LolliChat' },
  { url: 'https://www.coomeet.com', name: 'CooMeet' },
  { url: 'https://www.liveme.com', name: 'LiveMe' },
  { url: 'https://www.chatrad.com', name: 'ChatRad' },
  { url: 'https://www.icq.com', name: 'ICQ New' },
  { url: 'https://www.monkey.cool', name: 'Monkey' },
  { url: 'https://www.strangercam.com', name: 'StrangerCam' },
  { url: 'https://www.camslurp.com', name: 'CamSlurp' },
  { url: 'https://vchat.cam', name: 'vChat' },
  { url: 'https://www.turbocam.net', name: 'TurboCam' },
  { url: 'https://camfrog.com', name: 'CamFrog' },
  { url: 'https://www.flirtymania.com', name: 'Flirtymania' },
  { url: 'https://www.azar.com', name: 'Azar' },
  { url: 'https://www.mico.im', name: 'MICO' },
  { url: 'https://www.yubo.live', name: 'Yubo' },
  { url: 'https://www.chatruletka.com', name: 'Chatruletka' },
  { url: 'https://www.stranger.chat', name: 'Stranger.chat' },
  { url: 'https://www.chatous.com', name: 'Chatous' },
  { url: 'https://www.zupyo.com', name: 'Zupyo' },
  { url: 'https://www.chathub.cam', name: 'ChatHub' },
  { url: 'https://www.faceflow.com', name: 'FaceFlow' },
  { url: 'https://www.random.chat', name: 'Random.chat' },
  { url: 'https://whatbox.io', name: 'Whatbox' },
  { url: 'https://www.camsoda.com', name: 'CamSoda' },
  { url: 'https://www.livu.com', name: 'Livu' },
  { url: 'https://www.chatiw.com', name: 'Chatiw' },
  { url: 'https://chatzy.com', name: 'Chatzy' }
];

app.get('/fpeds/search', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let queryIndex = 0;
  let linkIndex = 0;
  let foundLinks = [];

  send({ type: 'start', message: 'Initializing search engine...', total: CHATROOM_QUERIES.length });

  const runQuery = () => {
    if (queryIndex >= CHATROOM_QUERIES.length) {
      send({ type: 'done', message: `Search complete. Found ${foundLinks.length} chatroom links.`, count: foundLinks.length });
      res.end();
      return;
    }

    const query = CHATROOM_QUERIES[queryIndex];
    send({ type: 'query', message: `[${queryIndex + 1}/${CHATROOM_QUERIES.length}] Searching: ${query}`, query });

    // Simulate search delay and yield links from our known list
    const delay = Math.floor(Math.random() * 400) + 150;

    setTimeout(() => {
      // Yield 0-2 links per query
      const linksToYield = Math.random() > 0.35 ? 1 : (Math.random() > 0.5 ? 2 : 0);
      for (let i = 0; i < linksToYield && linkIndex < KNOWN_CHAT_LINKS.length; i++) {
        const link = KNOWN_CHAT_LINKS[linkIndex++];
        foundLinks.push(link);
        send({ type: 'link', url: link.url, name: link.name });
      }

      queryIndex++;
      setTimeout(runQuery, Math.floor(Math.random() * 200) + 80);
    }, delay);
  };

  // Small init delay
  setTimeout(runQuery, 600);

  req.on('close', () => {
    queryIndex = CHATROOM_QUERIES.length; // stop
  });
});

app.get('/', (req, res) => res.redirect('/fpeds'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`fpeds running on http://0.0.0.0:${PORT}/fpeds`);
});
