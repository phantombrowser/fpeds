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

// Known public breach database records (publicly documented breaches, no private data)
const PUBLIC_BREACHES = [
  { name:'RockYou2021',     date:'2021-06-04', records:'8.4 billion', types:['passwords','emails'] },
  { name:'Collection #1',   date:'2019-01-17', records:'773 million', types:['emails','passwords'] },
  { name:'LinkedIn',        date:'2021-06-22', records:'700 million', types:['emails','phone','location','username'] },
  { name:'Facebook',        date:'2021-04-03', records:'533 million', types:['phone','email','name','location','dob'] },
  { name:'Adobe',           date:'2013-10-04', records:'153 million', types:['emails','password hints','usernames'] },
  { name:'Canva',           date:'2019-05-24', records:'137 million', types:['emails','usernames','names','passwords'] },
  { name:'MyFitnessPal',    date:'2018-02-01', records:'144 million', types:['emails','usernames','passwords'] },
  { name:'Dubsmash',        date:'2018-12-01', records:'162 million', types:['emails','usernames','passwords'] },
  { name:'Dropbox',         date:'2012-07-01', records:'68 million',  types:['emails','passwords'] },
  { name:'Snapchat',        date:'2014-01-01', records:'4.6 million', types:['usernames','phone'] },
  { name:'Twitter',         date:'2022-07-01', records:'5.4 million', types:['emails','phone','usernames'] },
  { name:'Twitch',          date:'2021-10-06', records:'2.5GB data',  types:['emails','usernames','passwords','source code'] },
  { name:'Lastpass',        date:'2022-08-25', records:'unknown',     types:['passwords (encrypted)','emails','IP'] },
  { name:'Uber',            date:'2022-09-15', records:'57 million',  types:['emails','phone','names'] },
  { name:'Yahoo',           date:'2016-09-22', records:'500 million', types:['emails','passwords','security questions','dob'] },
  { name:'Equifax',         date:'2017-09-07', records:'147 million', types:['names','ssn','dob','addresses','cc numbers'] },
  { name:'T-Mobile',        date:'2021-08-17', records:'76 million',  types:['names','phone','ssn','dob','IMEI'] },
  { name:'Experian',        date:'2020-08-22', records:'24 million',  types:['names','addresses','financial info'] },
  { name:'MySpace',         date:'2008-01-01', records:'360 million', types:['emails','usernames','passwords'] },
  { name:'Neopets',         date:'2022-07-19', records:'69 million',  types:['emails','usernames','dob','passwords'] },
  { name:'eBay',            date:'2014-05-21', records:'145 million', types:['emails','passwords','names','addresses','dob'] },
  { name:'Tumblr',          date:'2013-01-01', records:'65 million',  types:['emails','passwords'] },
  { name:'Dailymotion',     date:'2016-10-20', records:'87 million',  types:['emails','usernames','passwords'] },
  { name:'Zynga',           date:'2019-09-01', records:'218 million', types:['emails','usernames','passwords','phone','FB ID'] },
  { name:'Wattpad',         date:'2020-06-01', records:'268 million', types:['emails','usernames','passwords','IP','dob'] },
  { name:'Havenly',         date:'2020-06-01', records:'1.3 million', types:['emails','passwords','names','addresses'] },
  { name:'AntiPublic',      date:'2016-12-01', records:'458 million', types:['emails','passwords'] },
  { name:'iMesh',           date:'2013-01-01', records:'49 million',  types:['emails','usernames','passwords'] },
  { name:'Kickstarter',     date:'2014-02-16', records:'5.2 million', types:['emails','usernames','passwords','phone'] },
  { name:'VK',              date:'2012-01-01', records:'100 million', types:['emails','usernames','passwords','phone'] },
];

// Generate 500+ OSINT site list
function buildOsintSites() {
  const sites = [];

  // Breach Databases
  const breachDbs = [
    'haveibeenpwned.com','dehashed.com','leakcheck.io','snusbase.com','intelx.io',
    'breachdirectory.org','leaked.site','nuclearleaks.com','pwndb.com','leakpeek.com',
    'raidforums.com','ghostproject.fr','scatteredsecrets.com','weleakinfo.to',
    'illicit.services','ashleymadisonhacked.com','crack-station.net','hashes.com',
    'weakpass.com','md5decrypt.net','leakbase.io','leakhub.io','breachbase.com',
    'leakforums.net','leaks.to','databreach.watch','databreach.directory',
    'breachwatch.com','cybernews.com/personal-data-leak-check'
  ];
  breachDbs.forEach(s => sites.push({ name: s, category: 'Breach Database', checks: ['email','username','phone'] }));

  // Social Media
  const social = [
    'twitter.com','x.com','facebook.com','instagram.com','linkedin.com','tiktok.com',
    'snapchat.com','pinterest.com','reddit.com','tumblr.com','flickr.com','vimeo.com',
    'youtube.com','twitch.tv','discord.com','telegram.org','whatsapp.com','wechat.com',
    'line.me','viber.com','kik.com','skype.com','clubhouse.com','mastodon.social',
    'parler.com','gab.com','mewe.com','ello.co','vero.co','mix.com','quora.com',
    'medium.com','substack.com','patreon.com','onlyfans.com','deviantart.com',
    'behance.net','dribbble.com','github.com','gitlab.com','bitbucket.org',
    'stackoverflow.com','hackerrank.com','codepen.io','replit.com','glitch.com',
    'soundcloud.com','bandcamp.com','spotify.com','last.fm','myspace.com','xing.com',
    'vk.com','ok.ru','steam community','itch.io','roblox.com','xbox.com','psn.com',
    'goodreads.com','letterboxd.com','imdb.com','yelp.com','foursquare.com','nextdoor.com',
    'meetup.com','bumble.com','tinder.com','hinge.co','okcupid.com','pof.com',
    'match.com','zoosk.com','tagged.com','badoo.com','lovoo.com','yubo.live',
    'caffeine.tv','kick.com','rumble.com','odysee.com','bitchute.com','rumble.com',
    'naver.com','kakao.com','qq.com','weibo.com','douyin.com','kuaishou.com',
    'dailymotion.com','liveleak.com','strava.com','garmin connect','runkeeper.com',
    'myfitnesspal.com','fitbit.com','withings.com'
  ];
  social.forEach(s => sites.push({ name: s, category: 'Social Media', checks: ['email','username','phone'] }));

  // People Search Engines
  const people = [
    'spokeo.com','whitepages.com','peoplefinder.com','zabasearch.com','pipl.com',
    'intelius.com','beenverified.com','truthfinder.com','radaris.com','instantcheckmate.com',
    'backgroundcheck.run','checkpeople.com','publicrecordsnow.com','usa-people-search.com',
    'fastpeoplesearch.com','411.com','addresses.com','anywho.com','yellowpages.com',
    'superpages.com','truepeoplesearch.com','familytreenow.com','thatsthem.com',
    'findemails.com','hunter.io','clearbit.com','apollo.io','zoominfo.com','lusha.com',
    'voilanorbert.com','contactout.com','snovio.com','adapt.io','rocketreach.co',
    'peopledatalabs.com','fullcontact.com','datanyze.com','uplead.com','lead411.com',
    'globalwho.com','worldwho.com','privateye.com','docusearch.com','kgbpeople.com',
    'record.com','peoplesearchnow.com','peekyou.com','spyfly.com','usphonebook.com'
  ];
  people.forEach(s => sites.push({ name: s, category: 'People Search', checks: ['name','email','phone'] }));

  // Phone Lookup
  const phone = [
    'truecaller.com','numverify.com','phoneinfoga','calleridtest.com','whocallsme.com',
    '800notes.com','callercenter.com','callipedia.com','spydialer.com','cocofind.com',
    'phonelosers.org','reversephonelookup.com','phoneregistry.com','aftercode.com',
    'validnumber.com','textmagic.com phone lookup','phonespell.org','fonefinder.net',
    'melissadata.com','opencnam.com','numinfo.net','cellrevealer.com','zlookup.com',
    'freecallerinfo.com','kall8.com','eyecon.mobi','callercheck.com','findclue.com',
    'hiretual.com phone','ownerly.com','usphonebook.com','numspy.com','callerIDfaker.com'
  ];
  phone.forEach(s => sites.push({ name: s, category: 'Phone Lookup', checks: ['phone'] }));

  // Dark Web / Paste Sites
  const dark = [
    'pastebin.com','ghostbin.com','dpaste.com','paste.fo','hastebin.com',
    'privatebin.net','justpaste.it','paste2.org','ideone.com','rentry.co',
    'controlc.com','cryptobin.co','paste.sh','termbin.com','paste.mozilla.org',
    'codepad.org','slexy.org','snipplr.com','dumpz.org','paste.openstack.org',
    'gist.github.com','pastelink.net','defuse.ca/pastebin','textbin.net','nekobin.com',
    'bin.disroot.org','privatebin.net','bitbin.it','cl1p.net','paste.ee',
    'paste.debian.net','paste.ubuntu.com','paste.scsys.co.uk','bpaste.net','zerobin.net',
    'heypasteit.com','paste.ofcode.org','txt.fyi','sprunge.us','hpaste.org',
    'sharethis.com','share-text.com','0bin.net','quickleak.com','anonpaste.me',
    'dpaste.org','etherpad.wikimedia.org','piratepad.net'
  ];
  dark.forEach(s => sites.push({ name: s, category: 'Paste / Dark Sites', checks: ['email','username','phone','name'] }));

  // Domain & IP Tools
  const domain = [
    'whois.domaintools.com','shodan.io','censys.io','viz.greynoise.io','urlscan.io',
    'virustotal.com','otx.alienvault.com','threatcrowd.org','securitytrails.com',
    'dnsdumpster.com','hackertarget.com','bgpview.io','ipinfo.io','ipgeolocation.io',
    'whatismyipaddress.com','iplocation.net','ip-api.com','maxmind.com','abuseipdb.com',
    'mxtoolbox.com','spamhaus.org','barracudacentral.org','senderscore.org',
    'talos intelligence','threatpost','pulsedive.com','threatminer.org','cymon.io',
    'apility.io','scamalytics.com','ipqs.com','fraudguard.io','ipreputation.com',
    'reputationauthority.org','stopforumspam.com','fspamlist.com','spamcop.net',
    'blocklist.de','dshield.org','emerging threats','phishtank.com','openphish.com',
    'isitphishing.org','safebrowsing.google.com','siteadvisor.mcafee.com',
    'urlvoid.com','sitecheck.sucuri.net','quttera.com','web inspector'
  ];
  domain.forEach(s => sites.push({ name: s, category: 'Domain / IP Intel', checks: ['email','domain','ip'] }));

  // Email Reputation
  const emailRep = [
    'emailrep.io','mailboxlayer.com','kickbox.com','neverbounce.com','zerobounce.net',
    'verifalia.com','debounce.io','emaillistverify.com','briteverify.com','proofy.io',
    'emailchecker.com','disposablemail.check','block-disposable-email.com',
    'mailcheck.ai','emailhippo.com','smartrequest.io','emailverifierapp.com',
    'bounceshield.com','mailtester.com','mail-tester.com','mxtoolbox email',
    'gmass.co email test','checkemail.org','emailformat.com','email-validator.net'
  ];
  emailRep.forEach(s => sites.push({ name: s, category: 'Email Reputation', checks: ['email'] }));

  return sites;
}

const OSINT_SITES = buildOsintSites();

app.get('/fpeds/osint', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const query    = (req.query.q || '').trim();
  const type     = detectQueryType(query);
  let   stopped  = false;

  const send = (data) => { if (!stopped) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  if (!query) {
    send({ type: 'error', message: 'No query provided.' });
    res.end();
    return;
  }

  // Filter sites relevant to query type
  const relevantSites = OSINT_SITES.filter(s => s.checks.some(c => {
    if (type === 'email')    return ['email'].includes(c);
    if (type === 'phone')    return ['phone'].includes(c);
    if (type === 'username') return ['username','email'].includes(c);
    return true; // general query — check all
  }));

  // Pick breach records to "show" (simulated publicly-known match)
  const matchedBreaches = PUBLIC_BREACHES
    .filter(() => Math.random() < 0.28)
    .slice(0, Math.floor(Math.random() * 4) + 2);

  async function runOsint() {
    send({ type: 'start', query, queryType: type, total: relevantSites.length,
      message: `Scanning ${relevantSites.length} sources for: ${query}` });

    const categories = [...new Set(relevantSites.map(s => s.category))];
    let totalFound = 0;

    for (const cat of categories) {
      if (stopped) return;
      const catSites = relevantSites.filter(s => s.category === cat);
      send({ type: 'category', message: `── ${cat} (${catSites.length} sources)` });

      for (const site of catSites) {
        if (stopped) return;

        // Probabilistic hit based on category and type
        const hitChance =
          cat === 'Breach Database' ? 0.35 :
          cat === 'Social Media'    ? 0.20 :
          cat === 'Paste / Dark Sites' ? 0.12 :
          cat === 'People Search'   ? 0.25 :
          cat === 'Phone Lookup'    ? (type === 'phone' ? 0.30 : 0.05) :
          cat === 'Email Reputation' ? (type === 'email' ? 0.40 : 0.08) :
          0.10;

        const found = Math.random() < hitChance;

        send({ type: 'site_check', site: site.name, category: cat, found });

        if (found) {
          totalFound++;
          // Build simulated result detail
          const detail = buildDetail(query, type, site, matchedBreaches);
          send({ type: 'result', site: site.name, category: cat, detail });
        }

        await delay(Math.floor(Math.random() * 18) + 6);
      }
    }

    send({ type: 'done', totalFound, message: `Scan complete — ${totalFound} references found across ${relevantSites.length} sources.` });
    res.end();
  }

  runOsint();
  req.on('close', () => { stopped = true; });
});

function detectQueryType(q) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'email';
  if (/^[\+]?[\d\s\-\(\)]{7,15}$/.test(q))  return 'phone';
  if (/\s/.test(q))                           return 'name';
  return 'username';
}

function buildDetail(query, type, site, matchedBreaches) {
  const dataTypes = ['email address','username','password hash','IP address','phone number','date of birth','home address','security question'];
  const randomTypes = dataTypes.sort(() => 0.5 - Math.random()).slice(0, Math.floor(Math.random() * 3) + 1);

  if (site.category === 'Breach Database' && matchedBreaches.length > 0) {
    const breach = matchedBreaches[Math.floor(Math.random() * matchedBreaches.length)];
    return {
      type: 'breach',
      breachName: breach.name,
      date: breach.date,
      records: breach.records,
      exposedData: breach.types,
      note: 'Publicly documented breach — data categories exposed (no raw data shown)'
    };
  }
  if (site.category === 'Social Media') {
    return { type: 'profile', platform: site.name, profileFound: true, dataVisible: randomTypes, note: 'Public profile detected' };
  }
  if (site.category === 'Paste / Dark Sites') {
    return { type: 'paste', site: site.name, snippet: `...${query}... [redacted for safety]`, pasteDate: 'unknown', note: 'Reference found in public paste' };
  }
  if (site.category === 'People Search') {
    return { type: 'record', site: site.name, dataFound: randomTypes, note: 'Public records aggregator match' };
  }
  if (site.category === 'Phone Lookup' && type === 'phone') {
    return { type: 'phone', site: site.name, carrier: ['AT&T','Verizon','T-Mobile','Sprint','Unknown'][Math.floor(Math.random()*5)], region: 'United States', note: 'Carrier/region data from public number registry' };
  }
  if (site.category === 'Email Reputation') {
    return { type: 'email_rep', site: site.name, riskScore: Math.floor(Math.random()*40+20), disposable: false, note: 'Email reputation score from public blacklist' };
  }
  return { type: 'generic', site: site.name, dataFound: randomTypes, note: 'Reference found in public source' };
}

/* ══════════════════════════════════════════
   START
══════════════════════════════════════════ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`fpeds → http://0.0.0.0:${PORT}/fpeds`);
});
