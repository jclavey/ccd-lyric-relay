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

module.exports = { SONG, SCRIPTURE };
