// Word bank: things you can actually draw. Easy = one object, medium = a
// thing with a few parts or a simple scene, hard = a busier scene or action.

import { norm, clean } from './public/shared.js';

const list = (s) => s.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

const EASY = list(`
  apple, banana, cat, dog, sun, moon, star, tree, house, car, fish, bird, ball, book, cake, hat,
  shoe, cup, key, door, bed, chair, clock, egg, eye, hand, heart, ice cream, kite, lamp, leaf, lemon, lion,
  mouse, nose, pizza, rain, ring, robot, rocket, shark, snake, snowman, sock, spoon, table, train, umbrella,
  whale, window, flower, cloud, boat, bus, cookie, crown, drum, duck, frog, ghost, guitar, horse, ladder,
  mountain, pencil, pig, rainbow, sandwich, spider, tooth, turtle, balloon, bee, bone, bread, candle, carrot,
  cheese, corn, donut, fire, flag, fork, glasses, grapes, hamburger, igloo, ladybug, mushroom, octopus, owl,
  pear, penguin, pumpkin, rabbit, scissors, ship, snail, strawberry, sword, tent, tomato, watermelon, wheel,
  worm, zebra, anchor, arrow, axe, bat, bell, broom, butterfly, cactus, camera, castle, chicken, crab,
  diamond, dinosaur, elephant, envelope, feather, giraffe, hammer, island, kangaroo, lollipop, mailbox, map,
  monkey, moustache, necklace, pirate, planet, popcorn, puzzle, rose, skateboard, skull, snowflake, stairs,
  sunflower, swing, teapot, toothbrush, tractor, trophy, unicorn, television, bridge, cherry, cow, crayon,
  hot dog, ninja, sheep, slide, spaceship, taco, tiger, toilet, volcano, waffle, bucket,
  avocado, peach, coconut, broccoli, onion, potato, chili pepper, pretzel, croissant, cupcake, ice cube,
  snowball, mitten, boot, belt, comb, soap, button, paperclip, magnet, dice, acorn, seashell,
  mug, bottle, coin, rope, brick, nest, ant, goat, swan, taxi, sled, scarf, dress, couch, pillow, fence,
  rock, fly, cage, watch, suitcase, globe, whistle, doll, teddy bear, notebook, shovel, toast, bacon, pie,
  candy, pancake, sponge, flashlight, battery, phone,
  bear, fox, wolf, panda, deer, camel, ostrich, alien, angel, king, queen, baby, clown, witch, lightning,
  comet, french fries, sausage, noodles, burrito, milkshake, cotton candy, paper plane, pinwheel, bow tie,
  lipstick, flip flop, cheese wedge, candy cane, gift, party hat, magic wand, top hat,
  rubber duck, beach ball, bubble, bandage, padlock, treasure, shooting star, sandal, fishbone, tadpole,
  starfish, puddle, cave, tornado, ufo, earth, hourglass, kiwi, lemonade, ice pop
`);

const MEDIUM = list(`
  astronaut, backpack, barbecue, beach, beard, bicycle, birthday cake, bowling, campfire, cannon, carousel,
  chess, chimney, circus, compass, cowboy, dentist, desert, detective, dolphin, dragon, fireworks, fishing,
  flamingo, fountain, garden, hammock, haunted house, hedgehog, hot air balloon, jellyfish, jungle, karate,
  knight, laptop, lighthouse, magician, mermaid, microphone, microscope, mummy, parachute, peacock, piano,
  picnic, pineapple, popsicle, pyramid, raccoon, rollercoaster, sandcastle, saxophone, scarecrow, skeleton,
  sloth, snorkel, soccer, spaghetti, squirrel, submarine, sushi, swimming pool, treasure chest, trampoline,
  vampire, waterfall, werewolf, windmill, wizard, yoga, zombie, traffic light, vacuum cleaner, headphones,
  fire truck, toaster, bunk bed, pillow fight, game controller, zipper, helicopter, lasso, lumberjack,
  paintbrush, parrot, pogo stick, porcupine, sunglasses, telescope, thunderstorm, tightrope, tooth fairy,
  unicycle, water gun, bride and groom, whisk, x-ray, yo-yo, bathtub, bookshelf, crocodile, gingerbread man,
  jack in the box, message in a bottle, mosquito, piggy bank, sock puppet, spider web, superhero, light bulb,
  rhinoceros, hippopotamus, walrus, otter, beaver, koala, chameleon, seahorse, stingray, lobster, toucan,
  woodpecker, pelican, platypus, gorilla, frying pan, rolling pin, kettle, wheelbarrow, watering can, rake,
  chainsaw, washing machine, hair dryer, stapler, binoculars, alarm clock, garden gnome, birdhouse,
  fishing rod, treasure map, pirate ship, tennis racket, basketball hoop, hockey stick, surfboard, canoe,
  lantern, fire hydrant, park bench, lemonade stand, ice cream truck, drum set, electric guitar, violin,
  trumpet, school bus, chalkboard, graveyard, crystal ball, snow globe, tree house, roller skates,
  slingshot, catapult, dragonfly, scorpion, polar bear, snowboard, jetpack, bubble bath, banana peel,
  spinning top, robot arm, cuckoo clock, sea turtle, killer whale, bulldog, poodle,
  shark fin, cupid, genie lamp, pirate hat, viking, samurai, cowboy hat, fairy, troll,
  goblin, cyclops, yeti, bigfoot, kraken, phoenix, snowmobile, ambulance, police car, race car, tow truck,
  garbage truck, motorcycle, scooter, tank, airplane, hot tub, sauna, bonfire, scuba diver, lifeguard,
  mailman, chef, nurse, firefighter, farmer, ballerina, mime, juggler, cheerleader, drummer
`);

const HARD = list(`
  black hole, time machine, traffic jam, sunburn, brain freeze, hide and seek, moonwalk, photobomb,
  road trip, thumb war, trick or treat, counting sheep, juggling, sleepwalking, rocking chair,
  vending machine, karaoke, pickpocket, ventriloquist, fossil, oasis, canyon, ferris wheel, drawbridge,
  cable car, forklift, bulldozer, cement mixer, snowplow, steam engine, satellite dish, space station,
  lunar rover, wind turbine, suit of armor, pipe organ, gramophone, accordion, typewriter, claw machine,
  metal detector, coral reef, avalanche, skyscraper, aircraft carrier, ice sculpture, totem pole,
  stonehenge, eiffel tower, statue of liberty, sphinx, great wall, leaning tower of pisa, shipwreck,
  gondola, tugboat, hang glider, zip line, bungee jump, ski jump, sumo, rodeo, beekeeper, pumpkin patch,
  corn maze, marching band, snowball fight, pillow fort, food fight, tug of war, belly flop, snow angel,
  sneeze, pinata, mad scientist, one man band, pizza delivery, anglerfish, alien abduction, magic carpet,
  sword fight, arm wrestling, high five, ice fishing, crop circle, shadow puppet, ghost ship,
  walk the plank, loch ness monster, carnival, birthday party, sleepover,
  sunbathing, sandstorm, meteor shower, solar eclipse, northern lights, desert island,
  dog walker, bubble gum, dentist chair, operating room, bank robbery,
  jail cell, wishing well, fortune cookie, slot machine, roller disco, magic trick, rabbit in a hat,
  tightrope walker, human cannonball, lion tamer, trapeze, stilts, unicorn horn, mermaid tail,
  astronaut cat, dog surfing, cat nap, bird bath, fish tank, ant farm, spider on a web,
  frog on a lily pad, monkey on a branch, bear hug, elephant trunk, giraffe neck
`);

// Variant -> canonical DEFAULT prompt. Matching uses these; they are not extra prompts.
export const ALIASES = {
  mustache: 'moustache',
  doughnut: 'donut',
  donuts: 'donut',
  burger: 'hamburger',
  burgers: 'hamburger',
  hamburgers: 'hamburger',
  bunny: 'rabbit',
  bunnies: 'rabbit',
  rabbits: 'rabbit',
  ladybird: 'ladybug',
  ladybirds: 'ladybug',
  ladybugs: 'ladybug',
  rhino: 'rhinoceros',
  rhinos: 'rhinoceros',
  hippo: 'hippopotamus',
  hippos: 'hippopotamus',
  tv: 'television',
  tvs: 'television',
  bike: 'bicycle',
  bikes: 'bicycle',
  chilli: 'chili pepper',
  'chilli pepper': 'chili pepper',
  'chile pepper': 'chili pepper',
  'paper clips': 'paperclip',
  'ice cubes': 'ice cube',
  teddy: 'teddy bear',
  cellphone: 'phone',
  'cell phone': 'phone',
  'mobile phone': 'phone',
  gamepad: 'game controller',
  seahorses: 'seahorse',
  'hair drier': 'hair dryer',
  nessie: 'loch ness monster',
  fries: 'french fries',
  piñata: 'pinata',
  plane: 'airplane',
  aeroplane: 'airplane',
  motorbike: 'motorcycle',
  sasquatch: 'bigfoot',
};

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const w of arr) {
    const n = norm(w);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(w.trim());
  }
  return out;
}

export const WORDS = {
  easy: uniq(EASY),
  medium: uniq(MEDIUM),
  hard: uniq(HARD),
};

export function allDefaultWords() {
  return [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];
}

export function canonKey(s) {
  const n = norm(s);
  return ALIASES[n] ? norm(ALIASES[n]) : n;
}

export function matchesAnswer(guess, word) {
  const g = canonKey(guess);
  const w = canonKey(word);
  if (!g || !w) return false;
  if (g === w) return true;
  if (g.replace(/ /g, '') === w.replace(/ /g, '')) return true;
  return false;
}

// True when a run of whole words in `text` is the answer, an alias of it, or
// a plural ("lol bunnies" mentions "rabbit"). Whole words only, so "giant"
// does not mention "ant".
export function mentionsAnswer(text, word) {
  const w = canonKey(word).replace(/ /g, '');
  if (!w) return false;
  const toks = norm(text).split(' ').filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j <= Math.min(toks.length, i + 5); j++) {
      const run = toks.slice(i, j).join(' ');
      const c = canonKey(run).replace(/ /g, '');
      if (c === w || c === `${w}s` || c === `${w}es`) return true;
    }
  }
  return false;
}

// Host custom words: one entry per canonical answer (first label wins), so two
// spellings of one answer ("burger, hamburger") cannot pose as two prompts.
export function dedupeCustom(input, max = 500) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,\n]/);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const w = clean(r, 40).toLowerCase();
    const key = canonKey(w).replace(/ /g, '');
    if (w.length < 2 || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}
