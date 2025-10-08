const puppeteer = require('puppeteer');
const admin = require('firebase-admin');
const cron = require('node-cron');
const serviceAccount = require('./authsignkey.json');

// ===========================
// 🔹 Initialize Firebase
// ===========================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://livetvapp-reactjs-default-rtdb.firebaseio.com/'
});

// ===========================
// 🔹 Channels List
// ===========================
const linkFilters = [
  { name: 'Geo Tv', url: 'https://harpalgeo.tv/live/', filter: { keyword: 'harPalGeo', format: 'chunks.m3u8' } },
  { name: 'Sindh TV', url: 'https://tamashaweb.com/sindh-tv-live', filter: { keyword: 'sindhTV-abr', format: 'playlist.m3u8' } },
  { name: 'Hum TV', url: 'https://www.tamashaweb.com/hum-tv-live', filter: { keyword: 'humTV', format: 'chunks.m3u8' } },
  { name: 'Masala TV', url: 'https://tamashaweb.com/hum-masala-live', filter: { keyword: 'hummasala', format: 'chunks.m3u8' } },
  { name: 'TV ONE', url: 'https://tamashaweb.com/tv-one-live', filter: { keyword: 'TVOne', format: 'chunks.m3u8' } },
  { name: 'Sindh TV News', url: 'https://tamashaweb.com/sindh-tv-news-live', filter: { keyword: 'SindhNews', format: 'chunks.m3u8' } },
  { name: 'KTN', url: 'https://tamashaweb.com/ktn-entertainment-live', filter: { keyword: 'ktnEntertainment', format: 'chunks.m3u8' } },
  { name: 'KTN News', url: 'https://tamashaweb.com/ktn-news-live', filter: { keyword: 'ktnNews', format: 'chunks.m3u8' } },
  { name: 'Mehran TV', url: 'https://tamashaweb.com/mehran-tv-live', filter: { keyword: 'MehranTV', format: 'chunks.m3u8' } },
  { name: 'ARY Digital', url: 'https://www.tamashaweb.com/ary-digital-live', filter: { keyword: 'ARYdigital', format: 'chunks.m3u8' } },
  { name: 'Dunya News', url: 'https://dunyanews.tv/livehd/', filter: { keyword: 'dunyalivehd', format: '.m3u8' } },
  { name: 'Time News', url: 'https://tamashaweb.com/time-news-live', filter: { keyword: 'TimeNews', format: 'chunks.m3u8' } },
  { name: 'Samaa TV', url: 'https://tamashaweb.com/samaa-tv-live', filter: { keyword: 'samaaTV', format: 'chunks.m3u8' } },
  { name: 'Makkah Tv', url: 'https://tamashaweb.com/saudi-quran-makkah-tv-hd-live', filter: { keyword: 'Saudimakkah(nw)', format: 'chunks.m3u8' } },
  { name: 'Ary QTV', url: 'https://live.aryqtv.tv/', filter: { keyword: 'ARYQTVH', format: '.m3u8' } },
  { name: 'Geo News', url: 'https://www.tamashaweb.com/geo-news-live', filter: { keyword: 'geoNews', format: 'chunks.m3u8' } }
];

// ===========================
// 🔹 Main Logic with Safe Navigation
// ===========================
async function fetchAndStoreSessionData() {
  try {
    const browser = await puppeteer.launch({ headless: true });

    for (const { url: targetUrl, filter, name: channelName } of linkFilters) {
      console.log(`\n\x1b[44m[Processing]\x1b[0m ${channelName} → ${targetUrl}`);

      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(0); // disable default 30s timeout
      await page.setRequestInterception(true);

      let foundLink = false;
      let authSign = null;
      let sessionId = null;
      let nimbleId = null;

      const authSignRegex = /AuthSign=([^&]*)/i;
      const sessionIdRegex = /SessionId=([^&]*)/i;
      const nimbleRegex = /nimblesessionid=([^&]*)/i;

      page.on('request', async (request) => {
        const reqUrl = request.url();
        const lower = reqUrl.toLowerCase();
        const isTamasha = reqUrl.includes('tamashaweb.com');

        if (foundLink) {
          request.continue();
          return;
        }

        // Capture Tamasha tokens
        if (isTamasha) {
          const auth = authSignRegex.exec(reqUrl);
          const sess = sessionIdRegex.exec(reqUrl);
          const nim = nimbleRegex.exec(reqUrl);
          if (auth && !authSign) authSign = auth[1];
          if (sess && !sessionId) sessionId = sess[1];
          if (nim && !nimbleId) nimbleId = nim[1];
        }

        // Smart match keyword/format (case-insensitive)
        const matchKeyword = lower.includes(filter.keyword.toLowerCase());
        const matchFormat = lower.includes(filter.format.toLowerCase());

        if (matchKeyword && matchFormat) {
          foundLink = true;
          console.log(`\x1b[33m[FOUND]\x1b[0m ${channelName} → ${reqUrl}`);

          if (isTamasha) {
            if (authSign && sessionId && nimbleId) {
              await updateChannelUrlInFirebase(channelName, reqUrl, 'active');
              console.log(`\x1b[32m[SAVED]\x1b[0m Tamasha link with tokens for ${channelName}`);
            } else {
              await updateChannelUrlInFirebase(channelName, reqUrl, 'token_missing');
              console.warn(`⚠️ Missing AuthSign/SessionId/NimbleId for ${channelName}, saved as token_missing.`);
            }
          } else {
            await updateChannelUrlInFirebase(channelName, reqUrl, 'active');
            console.log(`\x1b[32m[SAVED]\x1b[0m Non-Tamasha link for ${channelName}`);
          }
        }

        request.continue();
      });

      // 🧠 Retry-safe navigation (3 attempts)
      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
          success = true;
          break;
        } catch (err) {
          console.warn(`⚠️ Attempt ${attempt} failed for ${targetUrl}: ${err.message}`);
          if (attempt === 3) console.error(`❌ Skipping ${channelName} after 3 failed attempts.`);
        }
      }

      if (success) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await new Promise((resolve) => setTimeout(resolve, 45000)); // wait for m3u8 links
      }

      await page.close();
    }

    await browser.close();
  } catch (err) {
    console.error('❌ Error fetching parameters:', err);
  }
}

// ===========================
// 🔹 Firebase Updater
// ===========================
async function updateChannelUrlInFirebase(channelName, newUrl, status) {
  try {
    const dbRef = admin.database().ref('channels');
    const snapshot = await dbRef.once('value');
    const channels = snapshot.val();

    if (!channels) {
      console.log('⚠️ No channels found in Firebase.');
      return;
    }

    const channelKey = Object.keys(channels).find(key => channels[key].name === channelName);
    if (channelKey) {
      await dbRef.child(channelKey).update({
        url: newUrl,
        status: status || 'active',
        lastUpdated: new Date().toISOString()
      });
      console.log(`✅ Updated Firebase: ${channelName} (${status})`);
    } else {
      console.log(`⚠️ Channel ${channelName} not found in Firebase.`);
    }
  } catch (err) {
    console.error('❌ Firebase update error:', err);
  }
}

// ===========================
// 🔹 CRON + Manual Run
// ===========================
cron.schedule('*/60 * * * *', () => {
  console.log('\n⏰ Scheduled task: running every 60 minutes...');
  fetchAndStoreSessionData();
});

// Run immediately
fetchAndStoreSessionData();
