/**
 * The emoji a comment can hold.
 *
 * A comment is prose, and half of what a face-to-face remark carries is not in
 * the prose — so the palette is here to be *typed* into a comment rather than
 * reacted with: the heart on a row is the reaction, and this is the other half
 * of the same thing, the tone of the sentence itself.
 *
 * The set is curated rather than complete. A full Unicode table is fifteen
 * hundred glyphs to scroll past in a panel the width of a hand, most of which
 * nobody would ever put in a sentence about a lesson; these are the ones people
 * actually reach for, in groups narrow enough to find one at a glance and named
 * well enough to search for one you cannot.
 */

/** One emoji, and the words somebody might type to find it. */
export interface Emoji {
  /** The glyph itself, as it is inserted into the text. */
  char: string;
  /** What it means, in lower case — the thing search matches against. */
  name: string;
}

/** A named row of the palette. */
export interface EmojiGroup {
  name: string;
  emojis: Emoji[];
}

/**
 * A group written as one string.
 *
 * `'👍 thumbs up, 👎 thumbs down'` — the glyph, a space, what it is called.
 * The catalogue is data, and data that reads as a list of emoji and their
 * meanings is data nobody has to decode: an array of objects would be the same
 * information spread over six lines each, and the names are the *only* thing
 * anyone will ever edit here.
 *
 * Glyph-first is what makes the split safe: an emoji is never part of the word
 * after it, while some names are several words long.
 */
function group(name: string, catalogue: string): EmojiGroup {
  return {
    name,
    emojis: catalogue.split(',').map((entry) => {
      const trimmed = entry.trim();
      const space = trimmed.indexOf(' ');
      return { char: trimmed.slice(0, space), name: trimmed.slice(space + 1) };
    }),
  };
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  group(
    'Faces',
    '😀 grinning, 😃 grinning big eyes, 😄 grinning smiling eyes, 😁 beaming, 😆 laughing, 😅 sweating laugh, 🤣 rolling on the floor, 😊 smiling eyes, 🙂 slight smile, 🙃 upside down, 😉 wink, 😌 relieved, 😍 heart eyes, 🥰 smiling with hearts, 😘 blowing a kiss, 😜 winking tongue, 🤪 zany, 🤔 thinking, 🤨 raised eyebrow, 🧐 monocle, 😐 neutral, 😴 sleeping, 😪 sleepy, 🥱 yawning, 😢 crying, 😭 sobbing, 😤 triumphant, 😬 grimacing, 😱 shocked, 🤯 mind blown, 🥳 partying, 😎 sunglasses, 🤓 nerd, 🤠 cowboy, 🫠 melting, 😇 innocent',
  ),
  group(
    'Hands',
    '👍 thumbs up, 👎 thumbs down, 👏 clapping, 🙌 raising hands, 🙏 thank you, 🤝 handshake, ✌️ victory, 🤞 fingers crossed, 👌 ok, 🫡 salute, 🤙 call me, 💪 flexed biceps, 👋 waving, 🖐️ raised hand, ✋ raised palm, 🤟 love you, 👉 pointing right, 👈 pointing left, ☝️ pointing up, 🫶 heart hands, 🤜 fist right, 🤛 fist left, 🖖 vulcan salute, 🤌 pinched fingers',
  ),
  group(
    'Hearts',
    '❤️ red heart, 🧡 orange heart, 💛 yellow heart, 💚 green heart, 💙 blue heart, 💜 purple heart, 🖤 black heart, 🤍 white heart, 💔 broken heart, ❤️‍🔥 heart on fire, 💖 sparkling heart, 💯 hundred, ✨ sparkles, 🔥 fire, 🎉 party popper, 🎊 confetti, 💡 light bulb, ⭐ star, 🌟 glowing star, 🏆 trophy, 🥇 gold medal, 🥈 silver medal, 🥉 bronze medal, 👏🏽 well done',
  ),
  group(
    'Study',
    '📚 books, 📖 open book, 📝 memo, ✏️ pencil, 🖊️ pen, 🖍️ crayon, 📐 triangular ruler, 📏 straight ruler, 🧮 abacus, 🎓 graduation cap, 🏫 school, 🔬 microscope, 🔭 telescope, 🧪 test tube, 🧠 brain, 💻 laptop, ⌨️ keyboard, 🖥️ desktop computer, 🗒️ notepad, 📌 pushpin, 📎 paperclip, 🔖 bookmark, 🗂️ index dividers, 🧑‍🎓 student, 🧑‍🏫 instructor, 👩‍🏫 teacher, 👨‍🏫 teacher, 👥 group, 🧑‍💻 technologist',
  ),
  group(
    'Objects',
    '⚙️ gear, 🔧 wrench, 🔨 hammer, 🛠️ tools, 🧰 toolbox, 🔑 key, 🗝️ old key, 🔒 locked, 🔓 unlocked, 📦 package, 📁 folder, 📂 open folder, 🖇️ linked paperclips, 📊 bar chart, 📈 trending up, 📉 trending down, 🗓️ calendar, ⏰ alarm clock, ⏳ hourglass, ⌛ hourglass done, 🧭 compass, 🎬 clapper board, 🎥 camera, 🎧 headphones, 🎤 microphone, 🎵 note, 🎶 notes, 📸 photo, 🖼️ picture, 🗺️ map, 🧩 puzzle, 🪄 magic wand, 🔍 magnifying glass, 🧵 thread, 🪞 mirror',
  ),
  group(
    'Nature',
    '🌱 seedling, 🌿 herb, 🌳 tree, 🌴 palm tree, 🍀 four leaf clover, 🌸 blossom, 🌻 sunflower, 🌈 rainbow, ☀️ sun, 🌤️ sun behind small cloud, ⛅ sun behind cloud, 🌧️ rain, ⛈️ thunderstorm, ❄️ snowflake, 🌊 wave, 🌙 crescent moon, ⚡ lightning, 🪐 ringed planet, 🚀 rocket, 🛰️ satellite, 🐝 bee, 🦋 butterfly, 🐙 octopus, 🦉 owl',
  ),
  group(
    'Food',
    '☕ coffee, 🍵 tea, 🧋 bubble tea, 🍎 apple, 🍌 banana, 🍇 grapes, 🍓 strawberry, 🍋 lemon, 🥑 avocado, 🍕 pizza, 🍔 burger, 🍟 fries, 🌮 taco, 🍣 sushi, 🍪 cookie, 🍩 donut, 🎂 cake, 🍰 shortcake, 🍫 chocolate, 🍿 popcorn, 🥗 salad, 🍜 ramen, 🍞 bread, 🧂 salt',
  ),
  group(
    'Marks',
    '✅ done, ☑️ checked box, ✔️ check, ❌ wrong, ❎ cross mark, ⚠️ warning, ❗ exclamation, ❓ question, ‼️ double exclamation, ⁉️ exclamation question, 💬 speech balloon, 💭 thought balloon, 🗯️ anger bubble, 🔔 bell, 🔕 muted bell, 📣 megaphone, 📢 loudspeaker, 🔗 link, ⏩ fast forward, ⏪ rewind, ⏸️ pause, ▶️ play, ⏹️ stop, 🔄 refresh, 🔁 repeat, 🔀 shuffle, 🆕 new, 🆗 ok, 🔝 top, 🎯 bullseye, 🏁 chequered flag, 🚩 flag',
  ),
];

/** Every emoji in the palette, in catalogue order. */
export const ALL_EMOJI: Emoji[] = EMOJI_GROUPS.flatMap((group) => group.emojis);

const BY_CHAR = new Map(ALL_EMOJI.map((emoji) => [emoji.char, emoji.name]));

/** What an emoji is called, for a title or an accessible name. */
export function emojiName(char: string): string | undefined {
  return BY_CHAR.get(char);
}

/**
 * The emoji whose name contains the query.
 *
 * Substring rather than prefix: somebody looking for the party one types "party"
 * and means `🎉 party popper`, not the eight emoji that happen to *begin* with
 * the word. Capped, because a search box is a way to narrow a palette and not a
 * way to read one.
 */
export function searchEmoji(query: string, limit = 48): Emoji[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return ALL_EMOJI.filter((emoji) => emoji.name.includes(needle)).slice(0, limit);
}

/**
 * Where the last few emoji somebody used are kept.
 *
 * `localStorage` rather than anything on the server: it is a habit of one
 * person's typing, not a fact about the discussion, and it should be there the
 * next time this browser writes a comment — including on another lesson, which
 * is the point of remembering it at all.
 */
const RECENT_KEY = 'play:recent-emoji';
const RECENT_LIMIT = 18;

/** The emoji this browser used last, most recent first. */
export function recentEmoji(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((char) => typeof char === 'string') : [];
  } catch {
    // A browser that refuses storage is a browser without recents, not an error.
    return [];
  }
}

/** Puts an emoji at the front of the recents, and answers with the new list. */
export function rememberEmoji(char: string): string[] {
  const next = [char, ...recentEmoji().filter((recent) => recent !== char)].slice(0, RECENT_LIMIT);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Ignore: the palette still works, it just does not remember.
    }
  }
  return next;
}
