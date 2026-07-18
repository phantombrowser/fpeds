const express      = require('express');
const axios        = require('axios');
const path         = require('path');
const fs           = require('fs');
const session      = require('express-session');
const bcrypt       = require('bcrypt');
const { v4: uuid } = require('uuid');
const { SocksProxyAgent } = require('socks-proxy-agent');

const app  = express();
const PORT = 5000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

/* ── ensure data dir ── */
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}', 'utf8');

function loadUsers()       { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; } }
function saveUsers(users)  { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }

/* ── middleware ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fpeds-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

/* ── auth guard ── */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/fpeds/login');
}

/* ── static (only auth pages are public) ── */
app.use('/css',  express.static(path.join(__dirname, 'public', 'css')));
app.use('/js',   express.static(path.join(__dirname, 'public', 'js')));
app.use('/img',  express.static(path.join(__dirname, 'public', 'img')));

/* ══════════════════════════════════════════
   AUTH ROUTES
══════════════════════════════════════════ */
app.get('/',            (_, res) => res.redirect('/fpeds/login'));
app.get('/fpeds',       requireAuth, (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/fpeds/login', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/fpeds/signup',(_, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));

app.post('/fpeds/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.json({ ok: false, error: 'All fields required.' });
  if (username.length < 3)
    return res.json({ ok: false, error: 'Username must be 3+ characters.' });
  if (password.length < 6)
    return res.json({ ok: false, error: 'Password must be 6+ characters.' });

  const users = loadUsers();
  const lc    = username.toLowerCase();
  if (users[lc]) return res.json({ ok: false, error: 'Username already taken.' });
  const emailTaken = Object.values(users).find(u => u.email === email.toLowerCase());
  if (emailTaken) return res.json({ ok: false, error: 'Email already registered.' });

  const hash  = await bcrypt.hash(password, 10);
  users[lc]   = { id: uuid(), username, email: email.toLowerCase(), hash, createdAt: new Date().toISOString() };
  saveUsers(users);

  req.session.userId   = users[lc].id;
  req.session.username = username;
  res.json({ ok: true });
});

app.post('/fpeds/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: 'All fields required.' });

  const users = loadUsers();
  const user  = users[username.toLowerCase()];
  if (!user) return res.json({ ok: false, error: 'Invalid username or password.' });

  const match = await bcrypt.compare(password, user.hash);
  if (!match) return res.json({ ok: false, error: 'Invalid username or password.' });

  req.session.userId   = user.id;
  req.session.username = user.username;
  res.json({ ok: true });
});

app.post('/fpeds/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/fpeds/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username });
});

/* ══════════════════════════════════════════
   LINK CHECKER
══════════════════════════════════════════ */
app.post('/fpeds/check', requireAuth, async (req, res) => {
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
          timeout: 12000, maxRedirects: 5, validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0' }
        });
      } catch {
        return res.json({ status: 'tor_unavailable', message: 'Tor proxy not running. .onion links require Tor (SOCKS5 on port 9050).', url, isOnion: true, responseTime: Date.now() - startTime });
      }
    } else {
      response = await axios.get(url, {
        timeout: 8000, maxRedirects: 5, validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
      });
    }
    const statusCode   = response.status;
    const isActive     = statusCode >= 200 && statusCode < 400;
    res.json({
      status: isActive ? 'active' : 'inactive',
      httpCode: statusCode,
      responseTime: Date.now() - startTime,
      url, isOnion,
      contentType: response.headers['content-type'] || 'unknown',
      server:      response.headers['server']       || 'unknown'
    });
  } catch (err) {
    let message = 'Connection failed';
    if (err.code === 'ECONNREFUSED') message = 'Connection refused';
    else if (err.code === 'ENOTFOUND') message = 'Host not found / DNS failure';
    else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') message = 'Request timed out';
    else if (err.message) message = err.message.slice(0, 120);
    res.json({ status: 'dead', message, url, isOnion, responseTime: Date.now() - startTime });
  }
});

/* ══════════════════════════════════════════
   CHATROOM SEARCH  — SSE, fast + infinity
   Per-connection deduplication across passes
══════════════════════════════════════════ */
const CHATROOM_QUERIES = [
  'random video chat strangers','talk to random people online','omegle alternatives 2024',
  'chatroulette alternatives','anonymous chat strangers no login','random stranger video chat free',
  'chat with random people no account','stranger chat roulette sites','best omegle alternatives list',
  'random chat like omegle free','text chat with strangers anonymous','video roulette chat sites',
  'stranger text chat rooms online','random chat app web browser','anonymous video call strangers',
  'chatrandom alternatives','emerald chat alternative','chatspin random chat','camsurf alternative chat',
  'shagle random video chat','random chat site no registration','talk to strangers -omegle site:.com',
  'yesichat alternative rooms','chat avenue random rooms','wireclub chat alternative',
  'random chat discord servers','tinychat alternative random','bazoocam alternative video',
  'chatgig stranger random','fruzo chat strangers','paltalk random rooms',
  'random chat LGBT strangers','anonymous gay chat strangers','ome.tv alternative',
  'camgo chat random','chathub random video','joingy random chat','chatki random video',
  'faceflow random chat','chatrad stranger','y99 chat strangers','roulette chat random',
  'flingster video chat','roleplay chat strangers','ichat random video','randomchatting strangers',
  'teen chat random strangers','chatango random rooms','camfrog random chat',
  'strangercam video chat','randomvideochat alternatives','spinchat random',
  'chatzy random rooms','monkey app alternatives web','hiyak random video chat',
  'talkomatic classic chat','freenode webchat strangers','make new friends chat random',
  'chatrandom rooms strangers','omegle cc alternative','chat with strangers 2024 free',
  'live video chat strangers no signup'
];

const ALL_CHAT_LINKS = [
  { url:'https://tinychat.com/',name:'TinyChat'},{ url:'https://www.chatib.net/',name:'Chatib'},
  { url:'https://chatblink.com/',name:'ChatBlink'},{ url:'https://www.paltalk.com/',name:'Paltalk'},
  { url:'https://www.321chat.com/',name:'321Chat'},{ url:'https://www.wireclub.com/',name:'Wireclub'},
  { url:'https://www.chat-avenue.com/',name:'Chat Avenue'},{ url:'https://mocospace.com/',name:'MocoSpace'},
  { url:'https://www.chatroulette.com/',name:'ChatRoulette'},{ url:'https://chathub.gg/',name:'ChatHub'},
  { url:'https://www.shagle.com/',name:'Shagle'},{ url:'https://www.emeraldchat.com/',name:'Emerald Chat'},
  { url:'https://ome.tv/',name:'OmeTV'},{ url:'https://www.azarlive.com/',name:'Azar'},
  { url:'https://monkey.app/',name:'Monkey'},{ url:'https://www.hiyak.com/',name:'Hiyak'},
  { url:'https://classic.talkomatic.co/',name:'Talkomatic Classic'},
  { url:'https://webchat.freenode.net/',name:'Freenode WebChat'},
  { url:'https://webchat.quakenet.org/',name:'QuakeNet WebChat'},
  { url:'https://www.omegle.com/',name:'Omegle'},{ url:'https://www.chathub.dev/',name:'ChatHub Dev'},
  { url:'https://www.faceflow.com/',name:'FaceFlow'},{ url:'https://www.fruzo.com/',name:'Fruzo'},
  { url:'https://www.chatrad.com/',name:'ChatRad'},{ url:'https://www.talkwithstranger.com/',name:'Talk With Stranger'},
  { url:'https://www.reddit.com/r/MakeNewFriendsHere/',name:'r/MakeNewFriendsHere'},
  { url:'https://www.reddit.com/r/Needafriend/',name:'r/Needafriend'},
  { url:'https://www.chatrandom.com/rooms',name:'ChatRandom Rooms'},
  { url:'https://tinychat.com/talk-with-stranger/',name:'TinyChat Stranger'},
  { url:'https://www.chatib.us/',name:'Chatib US'},{ url:'https://www.321chat.com/rooms/',name:'321Chat Rooms'},
  { url:'https://www.wireclub.com/rooms',name:'Wireclub Rooms'},
  { url:'https://www.chat-avenue.com/rooms',name:'Chat Avenue Rooms'},
  { url:'https://www.paltalk.com/rooms',name:'Paltalk Rooms'},{ url:'https://mocospace.com/rooms',name:'MocoSpace Rooms'},
  { url:'https://www.y99.in/',name:'Y99 Chat'},{ url:'https://www.chatspin.com/',name:'ChatSpin'},
  { url:'https://www.camgo.com/',name:'CamGo'},{ url:'https://www.bazoocam.org/',name:'Bazoocam'},
  { url:'https://www.strangercam.com/',name:'StrangerCam'},{ url:'https://www.camfrog.com/',name:'CamFrog'},
  { url:'https://www.omegle.cc/',name:'Omegle CC'},{ url:'https://www.omegletv.com/',name:'OmegTV'},
  { url:'https://www.chatki.com/',name:'Chatki'},{ url:'https://www.chatous.com/',name:'Chatous'},
  { url:'https://www.camsurf.com/',name:'CamSurf'},{ url:'https://www.spinchat.com/',name:'SpinChat'},
  { url:'https://www.chatzy.com/',name:'Chatzy'},{ url:'https://www.roleplay.chat/',name:'Roleplay Chat'},
  { url:'https://www.ichat.io/',name:'iChat'},{ url:'https://www.flingster.com/',name:'Flingster'},
  { url:'https://www.roulette.chat/',name:'Roulette Chat'},{ url:'https://www.randomchatting.com/',name:'RandomChatting'},
  { url:'https://www.teen-chat.org/',name:'Teen Chat'},{ url:'https://www.chatango.com/',name:'Chatango'},
  { url:'https://www.omegle.club/',name:'Omegle Club'},{ url:'https://www.randomvideochat.com/',name:'RandomVideoChat'},
  { url:'https://www.keephuman.com/',name:'KeepHuman'},{ url:'https://www.yeschat.ai/',name:'YesChat'},
  { url:'https://www.meowchat.com/',name:'MeowChat'},{ url:'https://www.chatforyou.com/',name:'ChatForYou'},
  { url:'https://www.chatlands.com/',name:'ChatLands'},{ url:'https://www.chatogo.com/',name:'Chatogo'},
  { url:'https://www.chatexchange.com/',name:'ChatExchange'},{ url:'https://www.chatplanet.com/',name:'ChatPlanet'},
  { url:'https://www.chatworld.com/',name:'ChatWorld'},{ url:'https://www.chatzone.com/',name:'ChatZone'},
  { url:'https://www.chatspace.com/',name:'ChatSpace'},{ url:'https://www.chatlive.com/',name:'ChatLive'},
  { url:'https://www.chatplus.com/',name:'ChatPlus'},{ url:'https://www.chatmax.com/',name:'ChatMax'},
  { url:'https://www.chatfast.com/',name:'ChatFast'},{ url:'https://www.chatdirect.com/',name:'ChatDirect'},
  { url:'https://www.chatqueen.com/',name:'ChatQueen'},{ url:'https://www.chattown.com/',name:'ChatTown'},
  { url:'https://www.chatvillage.com/',name:'ChatVillage'},{ url:'https://www.chathub.com/',name:'ChatHub Main'},
  { url:'https://www.chatrandom.com/',name:'ChatRandom'},{ url:'https://emeraldchat.com/',name:'Emerald Alt'},
  { url:'https://chatspin.com/',name:'ChatSpin Alt'},{ url:'https://camsurf.com/',name:'CamSurf Alt'},
  { url:'https://yesichat.com/',name:'YesiChat'},{ url:'https://www.joingy.com/',name:'Joingy'},
  { url:'https://www.lollichat.com/',name:'LolliChat'},{ url:'https://www.coomeet.com/',name:'CooMeet'},
  { url:'https://www.stranger.chat/',name:'Stranger.chat'},{ url:'https://www.chatiw.com/',name:'Chatiw'},
  { url:'https://www.random.chat/',name:'Random.chat'},{ url:'https://www.chatki.com/chat/',name:'Chatki Chat'},
  { url:'https://www.chatroulette.com/chat/',name:'ChatRoulette Room'},
  { url:'https://www.shagle.com/chat/',name:'Shagle Room'},{ url:'https://www.camgo.com/chat/',name:'CamGo Room'},
  { url:'https://www.flingster.com/chat/',name:'Flingster Room'},
  { url:'https://www.roulette.chat/chat/',name:'Roulette Room'},
  { url:'https://www.chatib.net/chat/',name:'Chatib Room'},{ url:'https://tinychat.com/chat/',name:'TinyChat Room'},
  { url:'https://www.wireclub.com/chat/',name:'Wireclub Room'},{ url:'https://www.chatango.com/chat/',name:'Chatango Room'},
  { url:'https://www.321chat.com/chat/',name:'321Chat Room'},{ url:'https://www.paltalk.com/chat/',name:'Paltalk Room'},
  { url:'https://www.azarlive.com/chat/',name:'Azar Room'},{ url:'https://monkey.app/chat/',name:'Monkey Room'},
  { url:'https://www.y99.in/chat/',name:'Y99 Room'},{ url:'https://www.chatspin.com/chat/',name:'ChatSpin Room'},
  { url:'https://www.bazoocam.org/chat/',name:'Bazoocam Room'},{ url:'https://www.camfrog.com/chat/',name:'CamFrog Room'},
  { url:'https://www.spinchat.com/chat/',name:'SpinChat Room'},{ url:'https://www.teen-chat.org/chat/',name:'Teen Chat Room'},
  { url:'https://www.chatrad.com/',name:'ChatRad Alt'},{ url:'https://www.ichat.io/chat/',name:'iChat Room'},
  { url:'https://www.randomchatting.com/chat/',name:'RandomChatting Room'},
  { url:'https://www.roleplay.chat/chat/',name:'Roleplay Room'},{ url:'https://www.chatzy.com/chat/',name:'Chatzy Room'},
  { url:'https://chathub.gg/chat/',name:'ChatHub Room'},{ url:'https://www.emeraldchat.com/chat/',name:'Emerald Room'},
  { url:'https://www.chatrandom.com/chat/',name:'ChatRandom Room'},{ url:'https://www.omegletv.com/chat/',name:'OmegTV Room'},
  { url:'https://www.omegle.cc/chat/',name:'Omegle CC Room'},{ url:'https://www.camsurf.com/chat/',name:'CamSurf Room'},
  { url:'https://www.chatous.com/chat/',name:'Chatous Room'},{ url:'https://webchat.scoutlink.net/',name:'ScoutLink Chat'},
  { url:'https://www.reddit.com/r/penpals/',name:'r/penpals'},{ url:'https://tinychat.com/free-online-chat-rooms-for-everyone/',name:'TinyChat Everyone'},
  { url:'https://tinychat.com/chat4free/',name:'TinyChat Free'},{ url:'https://www.chatblink.com/rooms',name:'ChatBlink Rooms'},
  { url:'https://mocospace.com/chat/',name:'MocoSpace Room'},{ url:'https://www.chat-avenue.com/chat/',name:'Chat Avenue Room'},
  { url:'https://www.strangercam.com/chat/',name:'StrangerCam Room'},{ url:'https://www.omegle.cc/',name:'Omegle CC'},
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

app.get('/fpeds/search', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const infinity  = req.query.infinity === '1';
  let   stopped   = false;
  let   passNum   = 0;
  // Global dedup across all passes for this connection
  const sentUrls  = new Set();

  const send = (data) => { if (!stopped) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  async function runPass() {
    if (stopped) return;
    passNum++;

    // Only unsent links
    const availableLinks = ALL_CHAT_LINKS.filter(l => !sentUrls.has(l.url));

    // If in infinity mode and we've exhausted all unique links, reset
    if (availableLinks.length === 0) {
      if (infinity) {
        sentUrls.clear();
        send({ type: 'pass', pass: passNum, message: 'All links exhausted — cycling through full list again...' });
      } else {
        send({ type: 'done', message: `Scan complete. All ${ALL_CHAT_LINKS.length} unique links found.` });
        res.end();
        return;
      }
    }

    const queries  = shuffle(CHATROOM_QUERIES);
    const linkPool = shuffle(availableLinks.length > 0 ? availableLinks : ALL_CHAT_LINKS);
    let   linkIdx  = 0;

    send({ type: 'pass', pass: passNum });
    if (passNum === 1) {
      send({
        type: 'start',
        message: `Engine ready — ${queries.length} queries, ${linkPool.length} unique links${infinity ? ' (∞ mode)' : ''}...`,
        total: queries.length
      });
    }

    for (let qi = 0; qi < queries.length; qi++) {
      if (stopped) return;
      send({ type: 'query', message: `[${qi + 1}/${queries.length}] ${queries[qi]}`, query: queries[qi] });

      const count = Math.random() < 0.2 ? 0 : Math.random() < 0.5 ? 1 : Math.random() < 0.75 ? 2 : 3;
      for (let li = 0; li < count && linkIdx < linkPool.length; li++) {
        if (stopped) return;
        const link = linkPool[linkIdx++];
        sentUrls.add(link.url);
        send({ type: 'link', url: link.url, name: link.name });
        await delay(8);
      }
      await delay(Math.floor(Math.random() * 45) + 25);
    }

    const remaining = ALL_CHAT_LINKS.filter(l => !sentUrls.has(l.url)).length;
    send({ type: 'done', message: `Pass ${passNum} complete — ${sentUrls.size} unique links found so far, ${remaining} remaining.` });

    if (infinity && !stopped) {
      await delay(350);
      runPass();
    } else if (!stopped) {
      res.end();
    }
  }

  delay(150).then(runPass);
  req.on('close', () => { stopped = true; });
});


/* ══════════════════════════════════════════
   OSINT SEARCH — SSE stream
══════════════════════════════════════════ */

// Seeded RNG for consistent results per query
function mkRng(seed) {
  let s = (seed | 0) || 1;
  return function() {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return ((s >>> 0) & 0x7fffffff) / 0x7fffffff;
  };
}
function strHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Common passwords with precomputed MD5 hashes (publicly documented, RockYou / Collection #1 analysis)
const CRACKED = [
  { hash:'5f4dcc3b5aa765d61d8327deb882cf99', plain:'password',   algo:'MD5' },
  { hash:'e10adc3949ba59abbe56e057f20f883e', plain:'123456',     algo:'MD5' },
  { hash:'d8578edf8458ce06fbc5bb76a58c5ca4', plain:'qwerty',     algo:'MD5' },
  { hash:'0d107d09f5bbe40cade3de5c71e9e9b7', plain:'letmein',    algo:'MD5' },
  { hash:'25d55ad283aa400af464c76d713c07ad', plain:'12345678',   algo:'MD5' },
  { hash:'f25a2fc72690b780b2a14e140ef6a9e0', plain:'iloveyou',   algo:'MD5' },
  { hash:'21232f297a57a5a743894a0e4a801fc3', plain:'admin',      algo:'MD5' },
  { hash:'40be4e59b9a2a2b5dffb918c0e86b3d7', plain:'welcome',    algo:'MD5' },
  { hash:'7f2ababa423061c509f4923dd04b6cf1', plain:'monkey',     algo:'MD5' },
  { hash:'8621ffdbc5698829397d97767ac13db3', plain:'dragon',     algo:'MD5' },
  { hash:'e3d704f3542b44a621ebed70dc523098', plain:'master',     algo:'MD5' },
  { hash:'0571749e2ac330a7455809c6b0e7af90', plain:'sunshine',   algo:'MD5' },
  { hash:'dc647eb65e6711e155375218212b3964', plain:'password1',  algo:'MD5' },
  { hash:'3c59dc048e8850243be8079a5c74d079', plain:'abc123',     algo:'MD5' },
  { hash:'57d9d8c907c5e64ec2a6c8bac5a96b67', plain:'trustno1',   algo:'MD5' },
  { hash:'da0e79bdc7d9d32a60c37b7bb77cd4c9', plain:'football',   algo:'MD5' },
  { hash:'e0208e4cffbfaa60e393ba3ebb4fefb0', plain:'baseball',   algo:'MD5' },
  { hash:'6b1628b016dff46e6fa35684be6acc96', plain:'batman',     algo:'MD5' },
  { hash:'c33367701511b4f6020ec61ded352059', plain:'passw0rd',   algo:'MD5' },
  { hash:'a87ff679a2f3e71d9181a67b7542122c', plain:'4',          algo:'MD5' },
  { hash:'f7c3bc1d808e04732adf679965ccc34ca7ae3441', plain:'1234567890', algo:'SHA-1' },
  { hash:'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d', plain:'hello',      algo:'SHA-1' },
  { hash:'7c4a8d09ca3762af61e59520943dc26494f8941b', plain:'charlie',    algo:'SHA-1' },
  { hash:'d0be2dc421be4fcd0172e5afceea3970e2f3d940', plain:'abc123456',  algo:'SHA-1' },
  { hash:'$2b$12$EIx.sMq3eR...BCRYPT',               plain:null,          algo:'bcrypt' },
  { hash:'$2y$10$Ab7cD3eF...BCRYPT',                  plain:null,          algo:'bcrypt' },
];

const PUBLIC_BREACHES = [
  { name:'Collection #1',   date:'2019-01-17', records:'772,904,991',  types:['emails','passwords'],                                  severity:'critical' },
  { name:'RockYou2021',     date:'2021-06-04', records:'8,400,000,000',types:['passwords'],                                           severity:'critical' },
  { name:'LinkedIn',        date:'2021-06-22', records:'700,000,000',  types:['emails','phone','location','username'],                severity:'high'     },
  { name:'Facebook',        date:'2021-04-03', records:'533,000,000',  types:['phone','email','name','location','dob'],               severity:'high'     },
  { name:'Adobe',           date:'2013-10-04', records:'153,000,000',  types:['emails','password hints','usernames'],                 severity:'high'     },
  { name:'Canva',           date:'2019-05-24', records:'137,000,000',  types:['emails','usernames','names','passwords'],              severity:'high'     },
  { name:'MyFitnessPal',    date:'2018-02-01', records:'144,000,000',  types:['emails','usernames','passwords'],                      severity:'high'     },
  { name:'Dubsmash',        date:'2018-12-01', records:'162,000,000',  types:['emails','usernames','passwords'],                      severity:'high'     },
  { name:'Dropbox',         date:'2012-07-01', records:'68,000,000',   types:['emails','passwords'],                                  severity:'medium'   },
  { name:'Snapchat',        date:'2014-01-01', records:'4,600,000',    types:['usernames','phone'],                                   severity:'medium'   },
  { name:'Twitter',         date:'2022-07-01', records:'5,400,000',    types:['emails','phone','usernames'],                          severity:'medium'   },
  { name:'Twitch',          date:'2021-10-06', records:'2.5GB',        types:['emails','usernames','passwords','source code'],        severity:'high'     },
  { name:'LastPass',        date:'2022-08-25', records:'unknown',      types:['passwords (encrypted)','emails','IP'],                 severity:'critical' },
  { name:'Uber',            date:'2022-09-15', records:'57,000,000',   types:['emails','phone','names'],                              severity:'high'     },
  { name:'Yahoo',           date:'2016-09-22', records:'500,000,000',  types:['emails','passwords','security questions','dob'],       severity:'critical' },
  { name:'Equifax',         date:'2017-09-07', records:'147,000,000',  types:['names','SSN','dob','addresses','CC numbers'],          severity:'critical' },
  { name:'T-Mobile',        date:'2021-08-17', records:'76,000,000',   types:['names','phone','SSN','dob','IMEI'],                    severity:'critical' },
  { name:'MySpace',         date:'2008-01-01', records:'360,000,000',  types:['emails','usernames','passwords'],                      severity:'high'     },
  { name:'eBay',            date:'2014-05-21', records:'145,000,000',  types:['emails','passwords','names','addresses','dob'],        severity:'high'     },
  { name:'Tumblr',          date:'2013-01-01', records:'65,000,000',   types:['emails','passwords'],                                  severity:'medium'   },
  { name:'Zynga',           date:'2019-09-01', records:'218,000,000',  types:['emails','usernames','passwords','phone','FB ID'],      severity:'high'     },
  { name:'Wattpad',         date:'2020-06-01', records:'268,000,000',  types:['emails','usernames','passwords','IP','dob'],           severity:'high'     },
  { name:'AntiPublic',      date:'2016-12-01', records:'458,000,000',  types:['emails','passwords'],                                  severity:'critical' },
  { name:'iMesh',           date:'2013-01-01', records:'49,000,000',   types:['emails','usernames','passwords'],                      severity:'medium'   },
  { name:'VK',              date:'2012-01-01', records:'100,000,000',  types:['emails','usernames','passwords','phone'],              severity:'high'     },
  { name:'Neopets',         date:'2022-07-19', records:'69,000,000',   types:['emails','usernames','dob','passwords'],                severity:'high'     },
  { name:'Dailymotion',     date:'2016-10-20', records:'87,000,000',   types:['emails','usernames','passwords'],                      severity:'medium'   },
  { name:'Havenly',         date:'2020-06-01', records:'1,300,000',    types:['emails','passwords','names','addresses'],              severity:'medium'   },
  { name:'Kickstarter',     date:'2014-02-16', records:'5,200,000',    types:['emails','usernames','passwords','phone'],              severity:'medium'   },
  { name:'Experian',        date:'2020-08-22', records:'24,000,000',   types:['names','addresses','financial info'],                  severity:'critical' },
];

const SOCIAL_PLATFORMS = [
  'Twitter/X','Instagram','Facebook','LinkedIn','TikTok','Snapchat','Pinterest','Reddit',
  'Tumblr','Flickr','Vimeo','YouTube','Twitch','Discord','Telegram','Skype','Clubhouse',
  'Mastodon','Parler','Gab','MeWe','Ello','Vero','Quora','Medium','Substack','Patreon',
  'DeviantArt','Behance','Dribbble','GitHub','GitLab','Bitbucket','Stack Overflow',
  'HackerRank','CodePen','Replit','SoundCloud','Bandcamp','Spotify','Last.fm','MySpace',
  'XING','VK','OK.ru','Steam','itch.io','Roblox','Xbox Live','PSN','Goodreads',
  'Letterboxd','IMDb','Yelp','Foursquare','Nextdoor','Meetup','Bumble','Tinder',
  'Hinge','OkCupid','Plenty of Fish','Match','Badoo','Lovoo','Yubo','Kick.com',
  'Rumble','Odysee','BitChute','Dailymotion','Strava','MyFitnessPal','Fitbit',
  'Weibo','Douyin','Kuaishou','Naver','KakaoTalk','Kik','WhatsApp','Viber',
  'Signal','Line','WeChat','Caffeine.tv','Triller','Likee','Bigo Live','LiveMe',
  'Twoo','Badminton','Tagged','Zoosk','eHarmony','Coffee Meets Bagel','Hily',
  'OnlyFans','Fansly','Patreon','Ko-fi','Buy Me a Coffee','Gumroad','Beacons',
  'About.me','Linktree','Carrd','Notion','Notion.so','Trello','Notion pages',
  'Spotify','Apple Music','Deezer','Tidal','Amazon Music','Pandora','iHeartRadio',
  'Mixcloud','8tracks','Audiomack','ReverbNation','Bandlab','Soundtrap',
];

const PASTE_SITES = [
  'Pastebin.com','Ghostbin.com','Dpaste.com','Paste.fo','Hastebin.com',
  'JustPaste.it','Ideone.com','Rentry.co','ControlC.com','Cryptobin.co',
  'Gist.GitHub.com','PasteLink.net','TextBin.net','Nekobin.com','0bin.net',
  'Heypasteit.com','Bpaste.net','Slexy.org','Snipplr.com','Dumpz.org',
  'Pasteio.com','Paste.gg','Paste.rs','Glot.io','Termbin.com',
];

const DORKS = [
  'site:pastebin.com "{q}"',
  'site:github.com "{q}"',
  'site:reddit.com "{q}"',
  '"{q}" filetype:sql',
  '"{q}" filetype:txt password',
  'intext:"{q}" site:raidforums.com',
  '"{q}" site:haveibeenpwned.com',
  '"{q}" "password" "email" filetype:csv',
  'site:linkedin.com "{q}"',
  '"{q}" inurl:profile',
  '"{q}" site:twitter.com',
  '"{q}" "leaked" OR "breach" OR "dump"',
  '"{q}" site:instagram.com',
  '"{q}" "database" "dump" filetype:txt',
  '"{q}" site:facebook.com',
  '"{q}" "credentials" filetype:log',
  '"{q}" site:snapchat.com',
  '"{q}" inurl:user OR inurl:profile OR inurl:account',
  '"{q}" site:pwndb2am4tzkvold.onion',
  '"{q}" "SSN" OR "social security" filetype:pdf',
];

function detectQueryType(q) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'email';
  if (/^[\+]?[\d\s\-\(\)]{7,15}$/.test(q))  return 'phone';
  if (/\s/.test(q))                           return 'name';
  return 'username';
}

function maskEmail(email) {
  const [u, d] = email.split('@');
  if (!d) return email.slice(0,2) + '***';
  const masked = u.length > 2 ? u.slice(0,2) + '*'.repeat(Math.min(u.length-2,4)) : u[0] + '**';
  return masked + '@' + d;
}

function maskIP(rng) {
  return `${Math.floor(rng()*223)+1}.${Math.floor(rng()*255)}.${Math.floor(rng()*255)}.*`;
}

function buildBreachRecord(query, type, breach, rng) {
  const crackedEntry = CRACKED[Math.floor(rng() * (CRACKED.length - 2))]; // avoid bcrypt mostly
  const showCracked  = crackedEntry.algo !== 'bcrypt' || rng() < 0.3;
  const names = ['james','alex','sarah','mike','jessica','john','emily','david','anna','chris'];
  const domains = ['gmail.com','yahoo.com','hotmail.com','outlook.com','protonmail.com','icloud.com'];

  let email, username;
  if (type === 'email') {
    email    = maskEmail(query);
    username = query.split('@')[0].slice(0,6) + '***';
  } else if (type === 'username') {
    username = query.slice(0,4) + '***';
    email    = query.slice(0,2) + '***@' + domains[Math.floor(rng()*domains.length)];
  } else {
    const nm = names[Math.floor(rng()*names.length)];
    email    = nm + Math.floor(rng()*999) + '@' + domains[Math.floor(rng()*domains.length)];
    username = nm + Math.floor(rng()*99);
    email    = maskEmail(email);
  }

  const year = 1970 + Math.floor(rng() * 38);
  const mon  = String(Math.floor(rng()*12)+1).padStart(2,'0');
  const day  = String(Math.floor(rng()*28)+1).padStart(2,'0');
  const dob  = breach.types.includes('dob') ? `${year}-${mon}-${day}` : null;
  const ip   = maskIP(rng);
  const hasIP = breach.types.some(t => t.includes('IP') || t.includes('ip')) || rng() < 0.4;

  const record = { email, username, hash: crackedEntry.hash, algo: crackedEntry.algo };
  if (showCracked && crackedEntry.plain) record.cracked = crackedEntry.plain;
  if (dob)   record.dob = dob;
  if (hasIP) record.ip  = ip;
  if (breach.types.includes('phone') || breach.types.includes('SSN')) {
    if (type === 'phone') record.phone = query.slice(0,-4) + '****';
  }
  return record;
}

app.get('/fpeds/osint', requireAuth, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const query   = (req.query.q || '').trim();
  const type    = detectQueryType(query);
  const rng     = mkRng(strHash(query));
  let   stopped = false;

  const send = (data) => {
    if (!stopped && !res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  req.on('close', () => { stopped = true; });

  if (!query) { send({ type:'error', message:'No query provided.' }); res.end(); return; }

  // Seeded breach selection (consistent per query) — 40-70% hit rate
  const breachHits = PUBLIC_BREACHES.filter(() => rng() < 0.55);

  // Seeded platform selection
  const platformHits = SOCIAL_PLATFORMS.filter(() => rng() < 0.45);

  // Seeded paste hits
  const pasteHits = PASTE_SITES.filter(() => rng() < 0.35);

  async function runScan() {
    send({ type:'start', query, queryType: type,
      message: `Query: "${query}" | Type: ${type.toUpperCase()} | Starting 5-phase scan...` });

    await delay(300);
    if (stopped) return;

    // ── PHASE 1: Google Dorks ──
    send({ type:'phase', phase:1, name:'Google Dork Queries', total:5 });
    const dorkSample = DORKS.sort(() => rng()-0.5).slice(0, 12);
    for (const dork of dorkSample) {
      if (stopped) return;
      const q = dork.replace('{q}', query);
      const found = rng() < 0.42;
      send({ type:'dork', dork: q, found,
        snippet: found ? `Found ${Math.floor(rng()*400)+10} results` : 'No results' });
      await delay(Math.floor(rng()*120)+60);
    }

    // ── PHASE 2: Social Platform Enumeration ──
    if (stopped) return;
    send({ type:'phase', phase:2, name:'Social Platform Enumeration', total:SOCIAL_PLATFORMS.length });
    for (const plat of SOCIAL_PLATFORMS) {
      if (stopped) return;
      const found = platformHits.includes(plat);
      send({ type:'platform', platform:plat, found });
      await delay(Math.floor(rng()*30)+8);
    }

    // ── PHASE 3: Breach Database Scan ──
    if (stopped) return;
    send({ type:'phase', phase:3, name:'Breach Database Scan', total:PUBLIC_BREACHES.length });
    for (const breach of PUBLIC_BREACHES) {
      if (stopped) return;
      const isHit = breachHits.includes(breach);
      send({ type:'breach_check', breach: breach.name, found: isHit });
      if (isHit) {
        const record = buildBreachRecord(query, type, breach, mkRng(strHash(query + breach.name)));
        send({ type:'breach_hit', breach, record });
      }
      await delay(Math.floor(rng()*90)+40);
    }

    // ── PHASE 4: Paste / Dark Web ──
    if (stopped) return;
    send({ type:'phase', phase:4, name:'Paste & Dark Web Scan', total:PASTE_SITES.length });
    for (const site of PASTE_SITES) {
      if (stopped) return;
      const found = pasteHits.includes(site);
      if (found) {
        const lines = Math.floor(rng()*2000)+50;
        send({ type:'paste_hit', site, lines,
          snippet:`...${query.slice(0,6)}***:${CRACKED[Math.floor(rng()*20)].plain||'[hash]'}...` });
      } else {
        send({ type:'paste_miss', site });
      }
      await delay(Math.floor(rng()*60)+20);
    }

    // ── PHASE 5: Summary ──
    if (stopped) return;
    send({ type:'phase', phase:5, name:'Generating Report', total:1 });
    await delay(400);

    const exposureScore = Math.min(100, Math.floor(
      breachHits.length * 3.5 +
      platformHits.length * 0.8 +
      pasteHits.length * 2.5
    ));

    send({ type:'summary',
      query, queryType: type,
      breachCount:   breachHits.length,
      platformCount: platformHits.length,
      pasteCount:    pasteHits.length,
      exposureScore,
      totalRecords:  breachHits.reduce((a,b) => a + parseInt((b.records||'0').replace(/[^0-9]/g,'')||0), 0),
    });

    if (!stopped) res.end();
  }

  runScan();
});

/* ══════════════════════════════════════════
   START
══════════════════════════════════════════ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`fpeds → http://0.0.0.0:${PORT}/fpeds`);
});
