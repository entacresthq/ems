/**
 * Words for temporary passwords: short, common and easy to spell when read out
 * over the phone. 256 words, so two of them plus four digits give about 655
 * million combinations. Keep the list at a power of two so every word is equally likely.
 */
// prettier-ignore
export const PASSWORD_WORDS = [
  'Acorn', 'Almond', 'Amber', 'Anchor', 'Apple', 'Apron', 'Arrow', 'Aspen',
  'Autumn', 'Badge', 'Bakery', 'Bamboo', 'Banana', 'Banjo', 'Barley', 'Basket',
  'Beacon', 'Beetle', 'Bell', 'Berry', 'Bicycle', 'Birch', 'Biscuit', 'Blossom',
  'Board', 'Bottle', 'Branch', 'Bread', 'Breeze', 'Brick', 'Bridge', 'Brook',
  'Bucket', 'Butter', 'Button', 'Cabin', 'Cactus', 'Camel', 'Candle', 'Canoe',
  'Canvas', 'Carpet', 'Carrot', 'Castle', 'Cedar', 'Cherry', 'Chimney', 'Circle',
  'Cloud', 'Clover', 'Cobalt', 'Coconut', 'Comet', 'Copper', 'Coral', 'Cotton',
  'Crane', 'Crayon', 'Crystal', 'Cypress', 'Daisy', 'Delta', 'Desert', 'Diamond',
  'Dolphin', 'Dragon', 'Drum', 'Eagle', 'Earth', 'Echo', 'Elbow', 'Ember',
  'Engine', 'Falcon', 'Feather', 'Fern', 'Ferry', 'Fiddle', 'Field', 'Finch',
  'Flame', 'Flute', 'Forest', 'Fossil', 'Fountain', 'Garden', 'Garnet', 'Ginger',
  'Glacier', 'Globe', 'Granite', 'Grape', 'Guava', 'Hammer', 'Harbour', 'Harvest',
  'Hazel', 'Helmet', 'Heron', 'Hill', 'Honey', 'Horizon', 'Island', 'Ivory',
  'Jacket', 'Jasmine', 'Jewel', 'Jungle', 'Kettle', 'Kite', 'Koala', 'Ladder',
  'Lagoon', 'Lantern', 'Lemon', 'Lilac', 'Lily', 'Lime', 'Linen', 'Lion',
  'Lotus', 'Magnet', 'Mango', 'Maple', 'Marble', 'Meadow', 'Melon', 'Meteor',
  'Mirror', 'Monkey', 'Moon', 'Mosaic', 'Mountain', 'Nectar', 'Needle', 'Nutmeg',
  'Oak', 'Oasis', 'Ocean', 'Olive', 'Onion', 'Orange', 'Orbit', 'Orchard',
  'Otter', 'Owl', 'Paddle', 'Palm', 'Panda', 'Papaya', 'Parrot', 'Peach',
  'Peanut', 'Pearl', 'Pebble', 'Pelican', 'Pepper', 'Piano', 'Pillow', 'Pine',
  'Planet', 'Plum', 'Pocket', 'Pond', 'Poppy', 'Prism', 'Pumpkin', 'Quartz',
  'Quilt', 'Rabbit', 'Radio', 'Rain', 'Raven', 'Reef', 'Ribbon', 'River',
  'Robin', 'Rocket', 'Rose', 'Ruby', 'Saddle', 'Saffron', 'Sail', 'Salmon',
  'Sand', 'Sapphire', 'Scarf', 'Shell', 'Silver', 'Sky', 'Sparrow', 'Spice',
  'Spring', 'Spruce', 'Star', 'Stone', 'Storm', 'Stream', 'Summer', 'Sun',
  'Swan', 'Table', 'Tango', 'Teapot', 'Thunder', 'Tiger', 'Timber', 'Tomato',
  'Topaz', 'Torch', 'Tower', 'Trumpet', 'Tulip', 'Tunnel', 'Turtle', 'Umbrella',
  'Valley', 'Velvet', 'Violet', 'Violin', 'Volcano', 'Wagon', 'Walnut', 'Water',
  'Wave', 'Whale', 'Wheat', 'Willow', 'Window', 'Winter', 'Wolf', 'Yam',
  'Yellow', 'Yogurt', 'Zebra', 'Zinc', 'Acacia', 'Baobab', 'Cashew', 'Cocoa',
  'Cowrie', 'Egret', 'Hibiscus', 'Kola', 'Mahogany', 'Okra', 'Plantain', 'Sorghum',
  'Tamarind', 'Iroko', 'Millet', 'Sesame', 'Shea', 'Hornbill', 'Gazelle', 'Giraffe',
] as const
