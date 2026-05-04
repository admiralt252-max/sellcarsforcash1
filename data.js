const intents = [
    'cash for', 
    'sell my', 
    'we buy', 
    'get an offer for',
    'who buys', 
    'top dollar for',
    'junk car removal',
    'scrap my',
    'cash on the spot for',
    'instant offer for',
    'sell my car fast',
    'get cash for',
    'get an offer on', 'instant cash for', 'scrap car removal'
];

const conditions = [
    'used',
    'accident damaged',
    'high mileage',
    'needs repairs',
    'not running',
    'clean title',
    'cosmetic damage',
    'mechanical issues',
    'scrap'
];

// Оставил только конкретные модели (без общих слов типа "BMW", чтобы не было "sell my BMW BMW X5")
const models = [
    'Honda CR-V', 'Toyota RAV4', 'Ford F-150', 'Honda Civic', 'Hyundai Elantra',
    'Toyota Corolla', 'Dodge RAM 1500', 'Nissan Rogue', 'Chevrolet Silverado', 'Mazda 3',
    'Honda Accord', 'Toyota Camry', 'Ford Escape', 'Jeep Grand Cherokee', 'Kia Sorento',
    'BMW 3 Series', 'Mercedes-Benz C-Class', 'Audi A4', 'Lexus RX', 'Hyundai Santa Fe', 'Subaru Forester', 
];

const locations = [
    'Toronto', 'Mississauga', 'Brampton', 'Vaughan', 'Markham', // Твои приоритетные города теперь в начале
    'Woodbridge', 'Concord', 'Richmond Hill', 'North York', 'Scarborough', 
    'Etobicoke', 'Oakville', 'Burlington', 'Newmarket', 'Aurora', 'Barrie', 'King City', 'Guelph'
];

module.exports = { intents, conditions, models, locations };