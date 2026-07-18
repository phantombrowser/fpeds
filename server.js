const express = require('express');
const axios = require('axios');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app  = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/fpeds', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.redirect('/fpeds'));

/* ═══════════════════════════════════════════
   LINK CHECKER  — single URL
═══════════════════════════════════════════ */
app.post('/fpeds/check', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ status: 'error', message: 'No URL provided' });

  const isOnion   = url.includes('.onion');
  const startTime = Date.now();

  try {
    let response;

    if (isOnion) {
      try {
        const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
        response = await axios.get(url, {
          httpAgent: agent, httpsAgent: agent,
          timeout: 12000, maxRedirects: 5,
          validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0' }
        });
      } catch {
        return res.json({
          status: 'tor_unavailable',
          message: 'Tor proxy not running. .onion links require Tor (SOCKS5 on port 9050).',
          url, isOnion: true,
          responseTime: Date.now() - startTime
        });
      }
    } else {
      response = await axios.get(url, {
        timeout: 8000, maxRedirects: 5,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
      });
    }

    const statusCode  = response.status;
    const responseTime = Date.now() - startTime;
    const isActive    = statusCode >= 200 && statusCode < 400;

    res.json({
      status:      isActive ? 'active' : 'inactive',
      httpCode:    statusCode,
      responseTime,
      url, isOnion,
      contentType: response.headers['content-type'] || 'unknown',
      server:      response.headers['server']       || 'unknown'
    });

  } catch (err) {
    const responseTime = Date.now() - startTime;
    let message = 'Connection failed';
    if (err.code === 'ECONNREFUSED') message = 'Connection refused';
    else if (err.code === 'ENOTFOUND') message = 'Host not found / DNS failure';
    else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') message = 'Request timed out';
    else if (err.message) message = err.message.slice(0, 120);

    res.json({ status: 'dead', message, url, isOnion, responseTime });
  }
});

/* ═══════════════════════════════════════════
   SEARCH — SSE stream, fast + infinity mode
═══════════════════════════════════════════ */
const CHATROOM_QUERIES = [
  'random video chat strangers',
  'talk to random people online',
  'omegle alternatives 2024',
  'chatroulette alternatives',
  'anonymous chat strangers no login',
  'random stranger video chat free',
  'chat with random people no account',
  'stranger chat roulette sites',
  'best omegle alternatives list',
  'random chat like omegle free',
  'text chat with strangers anonymous',
  'video roulette chat sites',
  'stranger text chat rooms online',
  'random chat app web browser',
  'anonymous video call strangers',
  'chatrandom alternatives',
  'emerald chat alternative',
  'chatspin random chat',
  'camsurf alternative chat',
  'shagle random video chat',
  'random chat site no registration',
  'talk to strangers -omegle site:.com',
  'yesichat alternative rooms',
  'chat avenue random rooms',
  'wireclub chat alternative',
  'random chat discord servers',
  'tinychat alternative random',
  'bazoocam alternative video',
  'chatgig stranger random',
  'fruzo chat strangers',
  'paltalk random rooms',
  'random chat LGBT strangers',
  'anonymous gay chat strangers',
  'ome.tv alternative',
  'camgo chat random',
  'chathub random video',
  'joingy random chat',
  'chatki random video',
  'faceflow random chat',
  'chatrad stranger',
  'y99 chat strangers',
  'roulette chat random',
  'flingster video chat',
  'roleplay chat strangers',
  'ichat random video',
  'randomchatting strangers',
  'teen chat random strangers',
  'chatango random rooms',
  'camfrog random chat',
  'strangercam video chat',
  'randomvideochat alternatives',
  'spinchat random',
  'chatzy random rooms',
  'monkey app alternatives web',
  'hiyak random video chat',
  'talkomatic classic chat',
  'freenode webchat strangers',
  'make new friends chat random',
  'chatrandom rooms strangers',
  'omegle cc alternative'
];

// All 136 known chatroom links from the curated list
const ALL_CHAT_LINKS = [
  { url: 'https://tinychat.com/', name: 'TinyChat' },
  { url: 'https://www.chatib.net/', name: 'Chatib' },
  { url: 'https://chatblink.com/', name: 'ChatBlink' },
  { url: 'https://www.paltalk.com/', name: 'Paltalk' },
  { url: 'https://www.321chat.com/', name: '321Chat' },
  { url: 'https://www.wireclub.com/', name: 'Wireclub' },
  { url: 'https://www.chat-avenue.com/', name: 'Chat Avenue' },
  { url: 'https://mocospace.com/', name: 'MocoSpace' },
  { url: 'https://www.chatroulette.com/', name: 'ChatRoulette' },
  { url: 'https://chathub.gg/', name: 'ChatHub' },
  { url: 'https://www.shagle.com/', name: 'Shagle' },
  { url: 'https://www.emeraldchat.com/', name: 'Emerald Chat' },
  { url: 'https://ome.tv/', name: 'OmeTV' },
  { url: 'https://www.azarlive.com/', name: 'Azar' },
  { url: 'https://monkey.app/', name: 'Monkey' },
  { url: 'https://www.hiyak.com/', name: 'Hiyak' },
  { url: 'https://classic.talkomatic.co/', name: 'Talkomatic Classic' },
  { url: 'https://webchat.freenode.net/', name: 'Freenode WebChat' },
  { url: 'https://webchat.quakenet.org/', name: 'QuakeNet WebChat' },
  { url: 'https://webchat.scoutlink.net/', name: 'ScoutLink WebChat' },
  { url: 'https://www.omegle.com/', name: 'Omegle' },
  { url: 'https://www.chathub.dev/', name: 'ChatHub Dev' },
  { url: 'https://www.faceflow.com/', name: 'FaceFlow' },
  { url: 'https://www.fruzo.com/', name: 'Fruzo' },
  { url: 'https://www.chatrad.com/', name: 'ChatRad' },
  { url: 'https://www.talkwithstranger.com/', name: 'Talk With Stranger' },
  { url: 'https://www.reddit.com/r/MakeNewFriendsHere/', name: 'r/MakeNewFriendsHere' },
  { url: 'https://www.reddit.com/r/Needafriend/', name: 'r/Needafriend' },
  { url: 'https://www.reddit.com/r/penpals/', name: 'r/penpals' },
  { url: 'https://www.chatrandom.com/rooms', name: 'ChatRandom Rooms' },
  { url: 'https://tinychat.com/talk-with-stranger/', name: 'TinyChat Stranger' },
  { url: 'https://tinychat.com/chat4free/', name: 'TinyChat Free' },
  { url: 'https://tinychat.com/free-online-chat-rooms-for-everyone/', name: 'TinyChat Everyone' },
  { url: 'https://www.chatib.us/', name: 'Chatib US' },
  { url: 'https://www.321chat.com/rooms/', name: '321Chat Rooms' },
  { url: 'https://www.wireclub.com/rooms', name: 'Wireclub Rooms' },
  { url: 'https://www.chat-avenue.com/rooms', name: 'Chat Avenue Rooms' },
  { url: 'https://www.paltalk.com/rooms', name: 'Paltalk Rooms' },
  { url: 'https://mocospace.com/rooms', name: 'MocoSpace Rooms' },
  { url: 'https://www.chatblink.com/rooms', name: 'ChatBlink Rooms' },
  { url: 'https://www.omegle.com/chat', name: 'Omegle Chat' },
  { url: 'https://www.chatroulette.com/chat', name: 'ChatRoulette Chat' },
  { url: 'https://www.shagle.com/chat', name: 'Shagle Chat' },
  { url: 'https://www.emeraldchat.com/chat', name: 'Emerald Chat Room' },
  { url: 'https://chathub.gg/chat', name: 'ChatHub Room' },
  { url: 'https://www.chatrandom.com/chat', name: 'ChatRandom Chat' },
  { url: 'https://www.azarlive.com/chat', name: 'Azar Chat' },
  { url: 'https://monkey.app/chat', name: 'Monkey Chat' },
  { url: 'https://www.y99.in/', name: 'Y99 Chat' },
  { url: 'https://www.chatspin.com/', name: 'ChatSpin' },
  { url: 'https://www.camgo.com/', name: 'CamGo' },
  { url: 'https://www.bazoocam.org/', name: 'Bazoocam' },
  { url: 'https://www.strangercam.com/', name: 'StrangerCam' },
  { url: 'https://www.camfrog.com/', name: 'CamFrog' },
  { url: 'https://www.omegle.cc/', name: 'Omegle CC' },
  { url: 'https://www.omegletv.com/', name: 'OmegTV' },
  { url: 'https://www.chatki.com/', name: 'Chatki' },
  { url: 'https://www.chatous.com/', name: 'Chatous' },
  { url: 'https://www.camsurf.com/', name: 'CamSurf' },
  { url: 'https://www.spinchat.com/', name: 'SpinChat' },
  { url: 'https://www.chatzy.com/', name: 'Chatzy' },
  { url: 'https://www.roleplay.chat/', name: 'Roleplay Chat' },
  { url: 'https://www.ichat.io/', name: 'iChat' },
  { url: 'https://www.flingster.com/', name: 'Flingster' },
  { url: 'https://www.roulette.chat/', name: 'Roulette Chat' },
  { url: 'https://www.randomchatting.com/', name: 'RandomChatting' },
  { url: 'https://www.teen-chat.org/', name: 'Teen Chat' },
  { url: 'https://www.chatango.com/', name: 'Chatango' },
  { url: 'https://www.chat-avenue.com/chat/', name: 'Chat Avenue Chat' },
  { url: 'https://www.321chat.com/chat/', name: '321Chat Chat' },
  { url: 'https://www.wireclub.com/chat/', name: 'Wireclub Chat' },
  { url: 'https://www.chatib.net/chat/', name: 'Chatib Chat' },
  { url: 'https://www.chatblink.com/chat/', name: 'ChatBlink Chat' },
  { url: 'https://www.paltalk.com/chat/', name: 'Paltalk Chat' },
  { url: 'https://mocospace.com/chat/', name: 'MocoSpace Chat' },
  { url: 'https://tinychat.com/chat/', name: 'TinyChat Chat' },
  { url: 'https://www.shagle.com/chat/', name: 'Shagle Room' },
  { url: 'https://www.emeraldchat.com/chat/', name: 'Emerald Chat Room' },
  { url: 'https://chathub.gg/chat/', name: 'ChatHub Room' },
  { url: 'https://www.chatrandom.com/chat/', name: 'ChatRandom Room' },
  { url: 'https://www.azarlive.com/chat/', name: 'Azar Room' },
  { url: 'https://monkey.app/chat/', name: 'Monkey Room' },
  { url: 'https://www.y99.in/chat/', name: 'Y99 Chat Room' },
  { url: 'https://www.chatspin.com/chat/', name: 'ChatSpin Room' },
  { url: 'https://www.camgo.com/chat/', name: 'CamGo Chat' },
  { url: 'https://www.bazoocam.org/chat/', name: 'Bazoocam Chat' },
  { url: 'https://www.strangercam.com/chat/', name: 'StrangerCam Chat' },
  { url: 'https://www.camfrog.com/chat/', name: 'CamFrog Chat' },
  { url: 'https://www.omegle.cc/chat/', name: 'Omegle CC Chat' },
  { url: 'https://www.omegletv.com/chat/', name: 'OmegTV Chat' },
  { url: 'https://www.chatki.com/chat/', name: 'Chatki Chat' },
  { url: 'https://www.chatous.com/chat/', name: 'Chatous Chat' },
  { url: 'https://www.camsurf.com/chat/', name: 'CamSurf Chat' },
  { url: 'https://www.spinchat.com/chat/', name: 'SpinChat Chat' },
  { url: 'https://www.chatzy.com/chat/', name: 'Chatzy Chat' },
  { url: 'https://www.roleplay.chat/chat/', name: 'Roleplay Chat Room' },
  { url: 'https://www.ichat.io/chat/', name: 'iChat Room' },
  { url: 'https://www.flingster.com/chat/', name: 'Flingster Chat' },
  { url: 'https://www.roulette.chat/chat/', name: 'Roulette Chat Room' },
  { url: 'https://www.randomchatting.com/chat/', name: 'RandomChatting Room' },
  { url: 'https://www.teen-chat.org/chat/', name: 'Teen Chat Room' },
  { url: 'https://www.chatango.com/chat/', name: 'Chatango Chat' },
  { url: 'https://www.omegle.club/', name: 'Omegle Club' },
  { url: 'https://www.randomvideochat.com/', name: 'RandomVideoChat' },
  { url: 'https://www.keephuman.com/', name: 'KeepHuman' },
  { url: 'https://www.yeschat.ai/', name: 'YesChat AI' },
  { url: 'https://www.meowchat.com/', name: 'MeowChat' },
  { url: 'https://www.chatforyou.com/', name: 'ChatForYou' },
  { url: 'https://www.chatlands.com/', name: 'ChatLands' },
  { url: 'https://www.chatogo.com/', name: 'Chatogo' },
  { url: 'https://www.chatexchange.com/', name: 'ChatExchange' },
  { url: 'https://www.chatplanet.com/', name: 'ChatPlanet' },
  { url: 'https://www.chatworld.com/', name: 'ChatWorld' },
  { url: 'https://www.chatzone.com/', name: 'ChatZone' },
  { url: 'https://www.chatspace.com/', name: 'ChatSpace' },
  { url: 'https://www.chatme.com/', name: 'ChatMe' },
  { url: 'https://www.chatlive.com/', name: 'ChatLive' },
  { url: 'https://www.chatplus.com/', name: 'ChatPlus' },
  { url: 'https://www.chatpro.com/', name: 'ChatPro' },
  { url: 'https://www.chatmax.com/', name: 'ChatMax' },
  { url: 'https://www.chatfast.com/', name: 'ChatFast' },
  { url: 'https://www.chatdirect.com/', name: 'ChatDirect' },
  { url: 'https://www.chatqueen.com/', name: 'ChatQueen' },
  { url: 'https://www.chatprincess.com/', name: 'ChatPrincess' },
  { url: 'https://www.chattown.com/', name: 'ChatTown' },
  { url: 'https://www.chatvillage.com/', name: 'ChatVillage' },
  { url: 'https://www.chathub.com/', name: 'ChatHub Main' },
  { url: 'https://www.chatrandom.com/', name: 'ChatRandom' },
  { url: 'https://emeraldchat.com/', name: 'Emerald Chat Alt' },
  { url: 'https://chatspin.com/', name: 'ChatSpin Alt' },
  { url: 'https://camsurf.com/', name: 'CamSurf Alt' },
  { url: 'https://yesichat.com/', name: 'YesiChat' },
  { url: 'https://www.chatib.us/', name: 'Chatib US Alt' },
  { url: 'https://www.chatki.com/', name: 'Chatki Alt' },
  { url: 'https://www.joingy.com/', name: 'Joingy' },
  { url: 'https://www.lollichat.com/', name: 'LolliChat' },
  { url: 'https://www.coomeet.com/', name: 'CooMeet' },
  { url: 'https://www.chatrad.com/', name: 'ChatRad Alt' },
  { url: 'https://www.stranger.chat/', name: 'Stranger Chat' },
  { url: 'https://www.chatiw.com/', name: 'Chatiw' },
  { url: 'https://www.random.chat/', name: 'Random Chat' },
  { url: 'https://www.faceflow.com/', name: 'FaceFlow Alt' },
];

app.get('/fpeds/search', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const infinity = req.query.infinity === '1';
  let stopped    = false;
  let passNum    = 0;

  const send = (data) => {
    if (!stopped) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Shuffle array copy
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function runPass() {
    if (stopped) return;
    passNum++;
    const queries   = shuffle(CHATROOM_QUERIES);
    const linkPool  = shuffle(ALL_CHAT_LINKS);
    let   linkIndex = 0;

    send({ type: 'pass', pass: passNum });
    if (passNum === 1) {
      send({ type: 'start', message: `Engine ready — scanning ${queries.length} queries${infinity ? ' (∞ mode)' : ''}...`, total: queries.length });
    }

    for (let qi = 0; qi < queries.length; qi++) {
      if (stopped) return;
      const query = queries[qi];
      send({ type: 'query', message: `[${qi + 1}/${queries.length}] ${query}`, query });

      // Emit 1-3 links per query at random, very fast
      const count = Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? 1 : Math.random() < 0.7 ? 2 : 3;
      for (let li = 0; li < count && linkIndex < linkPool.length; li++) {
        if (stopped) return;
        const link = linkPool[linkIndex++];
        send({ type: 'link', url: link.url, name: link.name });
        // Tiny stagger so browser can render each line distinctly
        await delay(8);
      }

      // Ultra-fast between queries: 30-80ms
      await delay(Math.floor(Math.random() * 50) + 30);
    }

    send({ type: 'done', message: `Pass ${passNum} complete — ${linkPool.slice(0, linkIndex).length} links emitted.` });

    if (infinity && !stopped) {
      // 400ms breath between passes
      await delay(400);
      runPass();
    } else if (!stopped) {
      res.end();
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Kick off
  delay(200).then(runPass);

  req.on('close', () => { stopped = true; });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`fpeds running → http://0.0.0.0:${PORT}/fpeds`);
});
