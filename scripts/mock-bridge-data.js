/**
 * Sample slides for mock-bridge.js. Each entry is the `slide.lines` the real
 * bridge would send. For Scripture, the first line is the reference.
 */

const SONG = {
  look: 'Song',
  presentation: { name: 'Amazing Grace', uuid: 'mock-song-amazing-grace' },
  slides: [
    ['Amazing grace, how sweet the sound', 'That saved a wretch like me'],
    ['I once was lost, but now am found', 'Was blind, but now I see'],
    ["'Twas grace that taught my heart to fear", 'And grace my fears relieved'],
    ['How precious did that grace appear', 'The hour I first believed'],
    ['Through many dangers, toils and snares', 'I have already come'],
    ["'Tis grace hath brought me safe thus far", 'And grace will lead me home'],
    // A deliberately long line to exercise font fitting.
    ['When we\'ve been there ten thousand years, bright shining as the sun', "We've no less days to sing God's praise than when we'd first begun"],
  ],
};

const SCRIPTURE = {
  look: 'Scripture',
  presentation: { name: 'Scripture', uuid: 'mock-scripture' },
  slides: [
    ['John 3:16', '1For God so loved the world, 2that he gave his only begotten Son, 3that whosoever believeth in him should not perish, but have everlasting life.'],
    ['Psalm 23:1-3', '1The LORD is my shepherd; I shall not want. 2He maketh me to lie down in green pastures: 3he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths of 4righteousness for his name\'s sake.'],
    ['Romans 8:38-39', '1For I am persuaded, that neither death, 1nor life, nor angels, nor principalities, nor powers, nor things present, 2nor things to come, nor height, nor depth, nor any other creature, shall be able to separate us from the love of God, which is in Christ Jesus our Lord.'],
    ['Philippians 4:6', '1Be careful for nothing; but in every 1thing by prayer and supplication with thanksgiving 3let your requests be made known unto God.'],
  ],
};

/**
 * Fake advert slides, drawn as SVG so no image files or libraries are needed.
 * The real bridge sends JPEGs; the relay and page don't care about the type.
 * Deliberately a mix of aspect ratios (16:9, 4:3, portrait) to exercise
 * contain-fitting.
 */
function advertSvg({ width, height, background, accent, headline, subline }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${background}"/>
  <rect x="${width * 0.06}" y="${height * 0.06}" width="${width * 0.88}" height="${height * 0.88}" fill="none" stroke="${accent}" stroke-width="${width * 0.006}"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${width * 0.09}" fill="#fff">${headline}</text>
  <text x="50%" y="60%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${width * 0.04}" fill="${accent}">${subline}</text>
</svg>`;
}

const ADVERTS = [
  { width: 1280, height: 720, background: '#1b3a5c', accent: '#ffd166', headline: 'Alpha Course', subline: 'Starts Tuesday 7:30pm' },
  { width: 1280, height: 720, background: '#5c1b3a', accent: '#8ee3ef', headline: 'Youth Camp', subline: 'Register at the welcome desk' },
  { width: 960, height: 720, background: '#2d5c1b', accent: '#fff3b0', headline: 'Foodbank Drive', subline: 'Bring tins next Sunday' },
  { width: 540, height: 960, background: '#3a1b5c', accent: '#ffb4a2', headline: 'Welcome', subline: 'Morning tea in the hall' },
].map((spec) => ({ mime: 'image/svg+xml', data: Buffer.from(advertSvg(spec)).toString('base64') }));

const PRESENTATION = {
  look: 'Presentation',
  presentation: { name: 'Announcements', uuid: 'mock-announcements' },
  slides: ADVERTS.map(() => []), // no lyric lines; the image is the content
  thumbnails: ADVERTS,
};

module.exports = { SONG, SCRIPTURE, PRESENTATION };
