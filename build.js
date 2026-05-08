'use strict';
/**
 * ontariocarbuyer.ca — Batch Static Site Generator
 *
 * Usage:
 *   node build.js              # generate next 50 pages
 *   node build.js --limit 500  # generate next 500 pages
 *   node build.js --limit 0    # generate ALL remaining pages
 *
 * State is persisted in generation-state.json so each run picks up
 * exactly where the last one left off.
 */

const fs   = require('fs');
const path = require('path');

// ── CLI argument: --limit <n> ─────────────────────────────────────────────
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1
    ? parseInt(process.argv[limitArg + 1], 10)
    : 50;                            // default: 50 pages per run

// ── Paths ─────────────────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname);
const DIST_DIR     = path.join(ROOT, 'dist');
const TEMPLATE_PATH= path.join(ROOT, 'template.html');
const STATE_PATH   = path.join(ROOT, 'generation-state.json');
const SITEMAP_PATH = path.join(DIST_DIR, 'sitemap.xml');
const LINKS_HUB    = path.join(DIST_DIR, 'links-hub.html');

const DOMAIN = 'https://wesellvancouver.ca'; // canonical domain — all URLs use this

// ── Imports ───────────────────────────────────────────────────────────────
const { intents, conditions, models, locations } = require('./data.js');

// ── Sanity checks ─────────────────────────────────────────────────────────
if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error('❌  template.html not found in ontario-car-buyer/');
    process.exit(1);
}

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// ── Copy images/ → dist/images/ ───────────────────────────────────────────
const IMAGES_SRC = path.join(ROOT, 'img-new-web');
const IMAGES_DST = path.join(DIST_DIR, 'images');
if (fs.existsSync(IMAGES_SRC)) {
    if (!fs.existsSync(IMAGES_DST)) fs.mkdirSync(IMAGES_DST, { recursive: true });
    const imgFiles = fs.readdirSync(IMAGES_SRC).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f)).sort();
    imgFiles.forEach((f, i) => {
        const ext = path.extname(f).toLowerCase();
        fs.copyFileSync(path.join(IMAGES_SRC, f), path.join(IMAGES_DST, `car-bought-${i + 1}${ext}`));
    });
}

// ── Build full combination list (City × Model × Condition × Intent) ───────
// Order: locations (priority-sorted) → models → conditions → intents
const allCombinations = [];
for (const location of locations) {
    for (const model of models) {
        for (const condition of conditions) {
            for (const intent of intents) {
                const cap   = intent.charAt(0).toUpperCase() + intent.slice(1);
                const title = `${cap} ${condition} ${model} in ${location}`;
                const slug  = title.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '') + '.html';
                allCombinations.push({ title, slug, location, model, condition, intent });
            }
        }
    }
}

const TOTAL = allCombinations.length;

// ── Load / initialise state ───────────────────────────────────────────────
let state = { lastIndex: -1, totalGenerated: 0 };
if (fs.existsSync(STATE_PATH)) {
    try {
        state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch (_) {
        console.warn('⚠️  generation-state.json is corrupt — starting from 0.');
    }
}

const startIndex = state.lastIndex + 1;

if (startIndex >= TOTAL) {
    console.log(`✅  All ${TOTAL} combinations have already been generated. Nothing to do.`);
    process.exit(0);
}

const effectiveLimit = (LIMIT === 0) ? TOTAL : LIMIT;
const endIndex       = Math.min(startIndex + effectiveLimit, TOTAL);  // exclusive
const batch          = allCombinations.slice(startIndex, endIndex);

console.log(`🚀  ontariocarbuyer.ca generator`);
console.log(`    Total combinations : ${TOTAL}`);
console.log(`    Already generated  : ${state.totalGenerated}`);
console.log(`    This batch         : ${batch.length} pages (index ${startIndex}–${endIndex - 1})`);
console.log(`    Remaining after run: ${TOTAL - endIndex}`);

// ── Load template ─────────────────────────────────────────────────────────
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// ── Helpers ── (toSlug defined below, used here via hoisting workaround) ──
function toSlugEarly(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── Ensure anchor pages: 1 page per model + 1 page per city ──────────────
// This guarantees all BLOCK_MODELS and BLOCK_LOCATIONS links always work
function ensureAnchors() {
    const anchorCombos = [];
    // 1 page per model × per city (cash for, used)
    for (const model of models) {
        for (const location of locations) {
            anchorCombos.push({ intent: 'cash for', condition: 'used', model, location });
        }
    }
    let created = 0;
    for (const a of anchorCombos) {
        const cap  = a.intent.charAt(0).toUpperCase() + a.intent.slice(1);
        const title = `${cap} ${a.condition} ${a.model} in ${a.location}`;
        const slug  = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.html';
        const filePath = path.join(DIST_DIR, slug);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '', 'utf8');
            created++;
        }
    }
    if (created > 0) console.log(`🔑  Anchor pages pre-created: ${created}`);
    return anchorCombos.map(a => {
        const cap  = a.intent.charAt(0).toUpperCase() + a.intent.slice(1);
        const title = `${cap} ${a.condition} ${a.model} in ${a.location}`;
        const slug  = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.html';
        return { ...a, title, slug };
    });
}

const anchorPages = ensureAnchors();

// ── Helpers ───────────────────────────────────────────────────────────────
function toSlug(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Build link blocks based ONLY on files that physically exist in dist/
// Called after batch is written so current batch pages are included
function buildStaticBlocks() {
    const existing = new Set(fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.html')));

    const BLOCK_MODELS = models
        .filter(m => {
            // Show model if ANY page for this model exists
            const slug = `cash-for-used-${toSlug(m)}-in-toronto.html`;
            return existing.has(slug) || [...existing].some(f => f.includes(toSlug(m)));
        })
        .map(m => {
            // Link to first existing page for this model
            const first = [...existing].find(f => f.includes(toSlug(m))) || '#';
            return `<a href="/${first}" class="lc">${m}</a>`;
        })
        .join('\n      ');

    const BLOCK_LOCATIONS = locations
        .filter(loc => [...existing].some(f => f.includes(`-in-${toSlug(loc)}.html`)))
        .map(loc => {
            const first = [...existing].find(f => f.includes(`-in-${toSlug(loc)}.html`)) || '#';
            return `<a href="/${first}" class="lc">${loc}</a>`;
        })
        .join('\n      ');

    const BLOCK_FOOTER_USED = models
        .filter(m => [...existing].some(f => f.includes(toSlug(m))))
        .slice(0, 6)
        .map(m => {
            const first = [...existing].find(f => f.includes(toSlug(m))) || '#';
            return `<li><a href="/${first}">${m}</a></li>`;
        })
        .join('\n          ');

    const BLOCK_FOOTER_SELL = locations
        .filter(loc => [...existing].some(f => f.includes(`-in-${toSlug(loc)}.html`)))
        .slice(0, 6)
        .map(loc => {
            const first = [...existing].find(f => f.includes(`-in-${toSlug(loc)}.html`)) || '#';
            return `<li><a href="/${first}">Sell My Car in ${loc}</a></li>`;
        })
        .join('\n          ');

    return template
        .replace(/\{\{BLOCK_MODELS\}\}/g,        BLOCK_MODELS)
        .replace(/\{\{BLOCK_LOCATIONS\}\}/g,     BLOCK_LOCATIONS)
        .replace(/\{\{BLOCK_FOOTER_USED\}\}/g,   BLOCK_FOOTER_USED)
        .replace(/\{\{BLOCK_FOOTER_SELL\}\}/g,   BLOCK_FOOTER_SELL);
}

// ── Inline spinner: resolves {a|b|c} recursively (deterministic by seed) ──
function inlineSpin(text, seed) {
    return text.replace(/\{([^{}]+)\}/g, function(_, choices) {
        const parts = choices.split('|');
        return parts[seed % parts.length];
    });
}

// ── Text spinning (deterministic — same slug → same variant always) ────────
const spinPool = {
    title: [
        '{Sell|Cash For} Your {{CONDITION}} {{MODEL}} in {{CITY}} — {Top Dollar|Instant Offer|Same-Day Cash}',
        '{{MODEL}} in {{CITY}}: {Get Cash|Sell Fast|Instant Offer} for Your {{CONDITION}} Car',
        '{We Buy|Cash For} {{CONDITION}} {{MODEL}} in {{CITY}}, Ontario — {Free Quote|No Obligation}',
        '{{CITY}} {{MODEL}} Sellers: {Get Paid Today|Cash in 60 Sec|Instant Cash Offer}',
        '{How Much Is|What\'s} Your {{CONDITION}} {{MODEL}} Worth in {{CITY}}? {Find Out|Get Offer} Now',
        'Sell Your {{CONDITION}} {{MODEL}} in {{CITY}} — {Same-Day Cash|No Dealership|Free Pickup}',
        '{Top Dollar|Best Price|Guaranteed Cash} for {{CONDITION}} {{MODEL}} in {{CITY}} | We Buy Cars',
        '{{CITY}} {{CONDITION}} {{MODEL}}: {Instant Cash Offer|We Buy Today|Free On-Site Quote}',
        'Get {Paid|Cash} for Your {{MODEL}} in {{CITY}} — {No Fees|No Waiting|We Come to You}',
        'We {Buy|Purchase} {{CONDITION}} {{MODEL}} in {{CITY}} — {Offer in 60 Seconds|Same-Day Payment}',
        'Sell Your {{CONDITION}} {{MODEL}} in {{CITY}} — {Cash Offer|Get Paid|Instant Quote} Today',
        '{Quick Sale|Fast Cash} for Your {{MODEL}} in {{CITY}} — {{CONDITION}} Condition OK',
        'Cash for {{MODEL}} in {{CITY}} | {{CONDITION}} Cars | We Buy Cars Ontario',
        'Sell {{CONDITION}} {{MODEL}} {{CITY}} — {Instant Offer|Top Price|No Middleman}',
        '{Need Cash|Selling Fast}? We Buy Your {{CONDITION}} {{MODEL}} in {{CITY}} Today',
    ],
    heading: [
        'Selling Your {{{CONDITION}}|{your} {{CONDITION}}} {{MODEL}} in {{CITY}}: What Local Sellers Need to Know',
        'The Fastest Way to Get {Cash|Top Dollar|Instant Payment} for Your {{MODEL}} in {{CITY}}',
        '{{CITY}} Residents: Sell Your {{CONDITION}} {{MODEL}} Without the {Dealership|Middleman} Hassle',
        'Why {{CITY}} {Owners|Sellers|Residents} Trust We Buy Cars to {Purchase|Buy} Their {{MODEL}}',
        'Get a {Guaranteed|Confirmed|No-Obligation} Cash Offer for Your {{CONDITION}} {{MODEL}} in {{CITY}}',
        'How to Sell Your {{MODEL}} in {{CITY}} and Get Paid {Same Day|Within Hours|Instantly}',
        '{{CITY}} {{MODEL}} Sellers: Stop Waiting — Get Your {Cash Offer|Quote} in {60 Seconds|Minutes}',
        'Turn Your {{CONDITION}} {{MODEL}} Into {Cash|Money} in {{CITY}} — No {Dealership|Listings} Required',
        '{{CITY}} Guide: Getting {Maximum|Top|Full Market} Value for a {{CONDITION}} {{MODEL}} in {{YEAR}}',
        'Selling a {{CONDITION}} {{MODEL}} in {{CITY}}: {Avoid|Skip} the {Private Listing|Dealership Trade-In}',
        'We {Buy|Purchase} {{CONDITION}} {{MODEL}} {Cars|Vehicles} in {{CITY}} — {Same-Day|Immediate} Payment',
        '{{CITY}} {{MODEL}} Owners: {Here\'s|This Is} What Your {Car|Vehicle} Is {Worth|Selling For} Right Now',
        '{Quick|Fast|Same-Day} Sale for Your {{CONDITION}} {{MODEL}} in {{CITY}} — {No Fees|No Hassle|No Waiting}',
        'The {{CITY}} {Seller\'s|Owner\'s} Complete Guide to {Cashing Out|Selling} a {{CONDITION}} {{MODEL}}',
        'Get {Paid|Your Money} Today for Your {{MODEL}} in {{CITY}} — {We Come to You|On-Site Pickup}',
        '{Instant|Same-Day|Guaranteed} Cash for {{CONDITION}} {{MODEL}} in {{CITY}}, Ontario',
        'We Buy {{CONDITION}} {{MODEL}} in {{CITY}} — {Free Pickup|No Transport Needed|We Come to You}',
        '{{CITY}} {{MODEL}} Sellers: {Your Car Is Worth More|Get More Cash} Than a Dealer Will Tell You',
        '{How Much|What} Is a {{CONDITION}} {{MODEL}} Worth in {{CITY}}? {Get|Receive} Your {Offer|Quote} Now',
        '{{CONDITION}} {{MODEL}} in {{CITY}}: {Sell|Cash Out} {Fast|Quickly|Today} with We Buy Cars',
        'Skip the {Listing|Dealership|Kijiji} — {Sell|Cash In} Your {{MODEL}} in {{CITY}} {Today|Right Now}',
        '{Tired of Waiting|Done with Lowball Offers}? Sell Your {{CONDITION}} {{MODEL}} in {{CITY}} {Today|Now}',
        'We {Offer|Pay} {Top Dollar|Market Rate|Guaranteed Cash} for {{CONDITION}} {{MODEL}} in {{CITY}}',
        '{{CITY}} Car Sellers: {Why|How} We Buy Cars {Beats|Outperforms} Every {Dealer|Trade-In} Offer',
        '{Sell|Offload} Your {{CONDITION}} {{MODEL}} in {{CITY}} — {Paperwork Included|We Handle Everything}',
        '{{CONDITION}} {{MODEL}} {Selling|Sale} in {{CITY}}: {Same-Day|Next-Day} Cash, {Zero|No} Fees',
        'Your {{MODEL}} in {{CITY}} Could Be Worth {$PRICERANGE} — {Find Out|Get Your Offer} Now',
        '{Looking to Sell|Ready to Cash Out}? We {Pay|Offer} {Top Dollar|Best Price} for {{MODEL}} in {{CITY}}',
        '{{CITY}} {{CONDITION}} {{MODEL}}: {We Buy|We Purchase} {All Conditions|Any Year|Any Mileage}',
        'Get {$PRICERANGE} for Your {{CONDITION}} {{MODEL}} in {{CITY}} — {Offer in 60 Seconds|Instant Quote}',
    ],
    p1: [
        'Selling a {{CONDITION}} {{MODEL}} in {{CITY}} privately means weeks of listing, UVIP paperwork, no-show test drives, and endless negotiating. We Buy Cars {eliminates|removes} every one of those steps. Submit your details in 60 seconds, receive a {guaranteed|confirmed} cash offer by phone, and get paid {the same day|within hours} — no listings, no strangers, no stress.',
        'If you own a {{CONDITION}} {{MODEL}} in {{CITY}}, the {GTA|Ontario} used-car market is working in your favour. Demand is {high|strong} and inventory is {tight|low}, which means buyers are willing to pay {strong|top} prices right now. Our team {delivers|provides} a {transparent|data-backed} quote within minutes — no obligation, no pressure.',
        'Ontario has one of the most active used-car markets in North America. A {{CONDITION}} {{MODEL}} in {{CITY}} attracts real demand from {private buyers|independent dealers|wholesalers} and {fleet operators|resellers}. When you sell through We Buy Cars, you receive a {confirmed|guaranteed} cash offer based on {live GTA|real Ontario} transaction data — not {outdated book values|stale estimates}.',
        'The biggest question when selling a {{CONDITION}} {{MODEL}} in {{CITY}} is always: am I getting a fair price? Our offers are {standalone|fully transparent|independently calculated} — built from real Ontario resale data for the {{MODEL}}, not bundled into {financing packages|dealer margins}. You see exactly what you\'re getting and {why|how we arrived at that number}.',
        'Most {{CITY}} residents who list their {{CONDITION}} {{MODEL}} privately wait {3–6 weeks|several weeks} before finding a committed buyer. Our {direct-purchase|cash-purchase} model collapses that timeline to {a single day|one afternoon}. One form, one phone call, one {same-day payment|instant transfer} — and you keep every dollar of the agreed price.',
        'Selling your {{CONDITION}} {{MODEL}} in {{CITY}} through a dealership typically means leaving {15–25%|thousands of dollars} of its value on the table. Trade-in quotes are designed to {subsidise dealer margins|pad the dealer\'s profit} — not maximise your return. We Buy Cars pays {market-rate|full wholesale} cash directly to you, with {zero deductions|no hidden fees}.',
        'Got a {{CONDITION}} {{MODEL}} sitting in your {{CITY}} {driveway|garage|parking spot}? Whether you\'re {upgrading|relocating|moving on}, We Buy Cars makes the sale {effortless|simple|stress-free}. Our licensed appraisers {come to you|visit your location}, assess the vehicle on-site, and {issue payment|transfer funds} before they leave.',
        'Many {{CITY}} sellers assume a {{CONDITION}} {{MODEL}} will be difficult to sell quickly. The reality: our {buyer network|purchasing team} is actively looking for {exactly this type|this specific model} of vehicle {right now|this week}. Submit the 60-second form, receive your offer, and have cash in hand {before the end of the day|within hours}.',
        'In {{YEAR}}, {{CITY}}-area demand for the {{MODEL}} remains {strong|consistent|above average}. Rising {interest rates|financing costs} have pushed more Ontario buyers toward {outright cash purchases|direct transactions}, which means sellers like you have {more leverage|a stronger position} than in previous years.',
        'We Buy Cars has {completed|processed} thousands of vehicle transactions across {{CITY}} and the {GTA|broader Ontario region}. Our streamlined {process|system} was built specifically for {{CITY}} sellers who want {maximum value|top dollar} without {dealership pressure|weeks of waiting}.',
        'A {{CONDITION}} {{MODEL}} in today\'s {{CITY}} market {commands|attracts} strong buyer interest. {Private listings|Kijiji ads} for this model average {3–5 weeks|several weeks} before a {confirmed|committed} sale. We skip the {waiting|listing} entirely — {one call|one form} and you\'re {paid|done}.',
        'The {{MODEL}} is one of {Ontario\'s|Canada\'s} most actively traded used vehicles, which works directly in your favour as a {{CITY}} seller. {Our offer reflects|We price based on} {real transaction data|live market values} — not what dealers hope to profit {after reconditioning|post-resale}.',
        'Selling privately in {{CITY}} requires {UVIP reports|vehicle history disclosures}, {test drives with strangers|multiple appointments}, and {weeks of negotiations|endless back-and-forth}. We handle the {entire process|paperwork, pickup, and payment} on your behalf — you simply {hand over the keys|accept the offer} and {get paid|walk away with cash}.',
        '{Thousands of|Hundreds of} {{CITY}} car owners have {chosen|used} We Buy Cars over {private listings|dealership trade-ins} because {we pay more|our process is faster} and {we come to you|you never leave home}. The {{MODEL}} is a {model we purchase daily|high-demand vehicle in our network}.',
        'If your {{MODEL}} in {{CITY}} has {high mileage|minor damage|cosmetic wear}, don\'t assume it\'s worth less than you think. Our {appraisers|buyers} {account for|factor in} real Ontario {resale demand|wholesale values} — {condition-adjusted pricing|fair market assessment} means {you get more|no lowball offers}.',
        'The {{CITY}} {seller\'s|cash-for-cars} market in {{YEAR}} is {favouring|rewarding} sellers who {move quickly|act now}. {Inventory levels|Available supply} for the {{MODEL}} {remain below average|are tight}, pushing {cash offers|prices} higher. {Contact us today|Submit your details} to lock in {current market rates|today\'s top offer}.',
        'We Buy Cars {purchases|acquires} {{CONDITION}} {{MODEL}} vehicles in {{CITY}} {seven days a week|every day}, including {evenings|weekends}. {No appointments needed|No prep required} — {we adapt|our team adjusts} to your {schedule|location} and complete the {full transaction|entire process} in {under 30 minutes|one visit}.',
        'Selling a {{CONDITION}} {{MODEL}} in {{CITY}} through {Kijiji|AutoTrader|private sale} means {paying listing fees|waiting weeks} and {dealing with tire-kickers|fielding lowball offers}. We Buy Cars {bypasses all of that|eliminates every step} — {guaranteed offer|confirmed price}, {same-day pickup|on-site assessment}, {immediate payment|instant transfer}.',
        'The {{MODEL}} {consistently ranks|regularly appears} among {Ontario\'s top 10|the most popular} {vehicles sellers offload|models sold for cash} in {{CITY}}. That {popularity|demand} directly {benefits|helps} you as a seller: {more competition|stronger buyer interest} means {higher offers|better prices} from {our buyer network|we buy cars}.',
        '{Before you list|Instead of listing} your {{CONDITION}} {{MODEL}} in {{CITY}}, {consider|think about} this: the {average private sale|typical Kijiji transaction} involves {3–8 serious inquiries|multiple viewings} before closing. Our {process|model} {skips every step|eliminates all of that} — {one offer, one pickup, one payment|it\'s that simple}.',
        'Your {{CONDITION}} {{MODEL}} in {{CITY}} is worth {real money|more than you think} right now. {We Buy Cars|Our team} {uses live auction data|tracks real transactions} from {across Ontario|the GTA} to {price your vehicle fairly|make our best offer}. {No guesswork|No pressure} — just a {transparent|honest} number {in 60 seconds|within minutes}.',
        '{Whether your|No matter if your} {{MODEL}} has {high kilometres|visible wear|a salvage title}, we {make an offer|buy it}. {{CITY}} sellers {frequently discover|often find out} that their {{CONDITION}} vehicle is worth {significantly more|far more} through {our buyer network|we buy cars} than {any dealer|any trade-in quote} {would offer|suggests}.',
        'We Buy Cars {operates across|serves all of} {{CITY}} {and surrounding areas|including nearby communities}. Our {team|appraisers} {visits your location|comes to you}, {completes the MTO transfer|handles all paperwork}, and {pays on the spot|transfers funds immediately}. {It\'s the easiest car sale|Sellers call it the simplest transaction} {they\'ve ever made|in Ontario}.',
        '{Cash for your|Sell your} {{CONDITION}} {{MODEL}} in {{CITY}} — {we make it simple|no complications}. {Our offer is based on|We price using} current {{CITY}}-area {resale data|transaction history}, {not|rather than} {book values|national averages} that {don\'t reflect|ignore} {local demand|your market}.',
        'The {current|{{YEAR}}} Ontario {used vehicle|pre-owned car} market is {one of the strongest|particularly active} for {{MODEL}} sellers. {Tight inventory|Low supply} and {high demand|strong buyer activity} in {{CITY}} {translate directly|convert} into {better offers|higher cash values} from {our network|we buy cars}.',
        'We Buy Cars {has purchased|has bought} {over 2,400|thousands of} vehicles {across Ontario|in {{CITY}} and the GTA}. {{CITY}} sellers {tell us|report} we {consistently outbid|routinely beat} {the competition|dealer trade-ins} — because our {direct-purchase model|process} {removes|eliminates} the {middleman|dealer margin} that {eats into|reduces} your {payment|offer}.',
        '{Stop waiting|Don\'t wait} for the {right buyer|perfect offer}. {We Buy Cars|Our team} {is actively purchasing|currently buying} {{CONDITION}} {{MODEL}} vehicles in {{CITY}} {this week|right now}. {Submit your details|Call us today} and {get your offer|find out what your car is worth} in {60 seconds|under a minute}.',
        'In a {typical|standard} {{CITY}} private sale, {sellers lose|you give up} {15–20%|thousands} to {negotiation|price haggling}. Our {offer system|pricing model} {is firm|doesn\'t change at pickup} — {what we quote|the number we give you} is {exactly what you receive|what you get paid}. {No last-minute cuts|No surprises}.',
        '{Your|A} {{CONDITION}} {{MODEL}} in {{CITY}} {could fetch|may be worth} {between $PRICERANGE|$PRICERANGE or more} depending on {year, trim, and mileage|condition and service history}. {Get your personalised number|Find out your exact value} with our {60-second form|instant quote tool} — {no commitment required|zero obligation}.',
        '{We\'ve helped|We\'ve assisted} {hundreds of|thousands of} {{CITY}} residents {sell|offload} their {used vehicles|{{CONDITION}} cars} {quickly and fairly|for top dollar}. The {{MODEL}} is {a model we know well|one of our most-purchased vehicles} — {our offers reflect that expertise|we price it accurately every time}.',
    ],
    p2: [
        'We cover all of {{CITY}} and the {surrounding GTA|broader Ontario area} with {free on-site|complimentary} pickup. Whether your {{MODEL}} is parked at {home|a storage facility|a workplace}, our team comes to you — no {transport costs|hidden fees|prep work} required.',
        '{Scheduling|Timing} matters. Our {{CITY}} pickup team operates {seven days a week|every day} including {evenings|weekends}, so you never need to {rearrange your day|take time off}. We {arrive within the agreed window|come on time}, confirm the offer on-site, and {transfer payment|pay you} before leaving — {e-transfer, cash, or certified cheque|your choice of payment method}.',
        '{Same-day service|Immediate pickup} is our standard, not a {premium|upgrade}. Once you confirm your offer for the {{MODEL}}, our dispatcher {allocates|assigns} a {{CITY}}-area driver {immediately|within the hour}. We handle all {MTO ownership transfer|paperwork} documents on-site — you sign {once|one form}, we manage the rest.',
        'No need to {book a ServiceOntario appointment|research UVIP requirements}. Our {licensed|experienced} team brings {every document|all paperwork} required for a {legal|clean} Ontario vehicle transfer to your {{CITY}} address. The entire process — {inspection, paperwork, payment|appraisal, transfer, payment} — takes {under 30 minutes|less than half an hour} from arrival.',
        'Our {{CITY}} appraisers {don\'t renegotiate|never change the price} at pickup. The {price we quote|offer we give} over the phone is the {price you receive|amount you get paid} when we arrive. {No last-minute deductions|No surprise reductions} for {minor wear|small imperfections} — {what we quote, we pay|our word is our offer}.',
        '{Pickup logistics|Transport arrangements} are {completely on us|our responsibility}. Our team {knows {{CITY}} and the broader GTA well|is based in your area} — we {dispatch quickly|respond fast}, arrive on time, and {carry full documentation|bring all paperwork} for an immediate MTO transfer. You {hand over the keys|provide the ownership}; we {hand over your payment|pay you immediately}.',
        'For {{CITY}} sellers with {busy schedules|demanding routines}, our {evening and weekend|flexible} availability means you {never have to take time off|can schedule around your life}. Book a {same-day|next-morning} appointment and we\'ll come to {wherever the vehicle is|your location}.',
        'Whether you\'re in {central {{CITY}}|downtown} or {on the outskirts|in the suburbs}, our pickup {radius|zone} covers the {entire area|whole city}. We\'ve completed {thousands of|countless} transactions across Ontario — our process is {fast|efficient}, {professional|licensed}, and {completely hassle-free|stress-free} for the seller.',
        '{Payment is immediate|We pay on the spot}. Once we {verify|confirm} the {{MODEL}} matches the {quoted description|details provided}, we {issue payment|transfer funds} before {leaving your property|our team departs}. {Most {{CITY}} sellers|Our clients} {receive payment|get paid} within {minutes of our arrival|30 minutes of us arriving}.',
        'We {bring|carry} {all the paperwork|every form} needed for a {clean MTO|legal Ontario} ownership transfer to your {{CITY}} {address|location}. You {don\'t need to|won\'t have to} {research transfer requirements|visit a ServiceOntario location} — our team {handles every step|takes care of everything} {on the spot|during the pickup}.',
        'Our {{CITY}} {team|appraisers} {complete|finalize} the {full transaction|entire sale} in {one visit|a single appointment}. {From the moment we arrive|Starting when we show up} to the moment {you\'re paid|the transfer is complete}, most sellers {report|tell us} the {experience|process} took {under 30 minutes|less than half an hour}.',
        '{Free pickup|No-cost vehicle collection} across {all of {{CITY}}|{{CITY}} and surrounding areas}. We don\'t {charge transport fees|bill for our time} — the {price we offer|quoted amount} is the {net amount|full amount} you {receive|get paid}. {No deductions|Zero fees} for {distance|pickup logistics}.',
        'We Buy Cars {operates|runs} a {full-time pickup fleet|dedicated vehicle collection team} across {{CITY}}. {Dispatch times|Response windows} are {typically 2–4 hours|usually same-day} after {offer confirmation|you accept}. {We don\'t ask you to come to us|You never have to drive anywhere} — {our team handles the logistics|we come to you}.',
        '{Whether your {{MODEL}} is|No matter if your car is} {running or not|drivable or damaged}, we can {arrange pickup|collect it}. Our {flatbed-equipped|fully capable} {{CITY}} team {handles all conditions|picks up any vehicle} — {no restrictions|no exclusions based on condition}.',
        'Our {{CITY}} {pickup appointments|collection slots} {fill quickly|book up fast}, especially {on weekends|in the evenings}. {Contact us early|Call or submit your form today} to {lock in|secure} your {preferred time|appointment slot} — we {accommodate|work around} {most schedules|any availability}.',
        'The {MTO ownership transfer|vehicle ownership process} in Ontario {involves several steps|requires specific documents}. Our {licensed|experienced} {{CITY}} team {knows every step|handles every requirement} — we {prepare|bring} {all forms|everything needed} to your {address|location} so the {process|handover} is {clean and legal|fully compliant}.',
        'We Buy Cars {{CITY}} {appraisers|buyers} are {trained|certified} to {assess|evaluate} {all makes, models, and conditions|any vehicle}. {Your {{MODEL}}|The vehicle} is {inspected quickly|assessed on the spot} and {our offer|the quoted price} is {confirmed immediately|validated at pickup} — {no surprises|exactly as quoted}.',
        '{Seven-day|Daily} availability {across {{CITY}}|in your area}. {Morning, afternoon, or evening|Any time of day} — our {pickup team|collection crew} works {around your schedule|when it\'s convenient for you}. {Most {{CITY}} appointments|Same-day requests} are {accommodated|honoured} with {2–4 hour|short} lead times.',
        'Selling your {{MODEL}} in {{CITY}} has {never been easier|never been simpler}. {Our team does all the work|We handle everything} — you {accept the offer|agree to the price}, we {show up|arrive}, we {pay you|transfer funds}, we {drive away|take the vehicle}. {Start to finish|The whole process}: {under an hour|60 minutes or less}.',
        '{No paperwork research|No forms to fill out} on your end. Our {{CITY}} {team|appraisers} arrive with {all Ontario-required|every necessary} {transfer documents|ownership forms} {pre-prepared|ready to sign}. You {sign once|provide your signature}, {hand over the ownership|give us the ownership document}, and you\'re {paid and done|finished}.',
        'We respect your {time|schedule}. Our {{CITY}} {appointments|pickups} {run on time|are punctual} — {we don\'t make you wait|no waiting around}. If {we\'re delayed|anything changes}, we {call ahead|notify you immediately}. {Our sellers\' time|Your time} is {as valuable as|just as important as} ours.',
        '{We\'ve served|Our team has helped} {{CITY}} {residents|sellers} for {years|over a decade} — {we know the neighbourhoods|we\'re familiar with every area}, {common vehicle types|popular models in your area}, and {what the local market|what buyers in your city} {is looking for|want to purchase}. That {local knowledge|area expertise} {translates into|means} {better offers|fairer prices} for you.',
        'The {{MODEL}} {pickup process|collection appointment} in {{CITY}} is {straightforward|simple}: {confirm your offer|accept online or by phone}, {choose a time|pick your slot}, we {arrive|show up}, {inspect briefly|verify the vehicle}, {sign the transfer|complete the paperwork}, {pay immediately|transfer your money}. {Done|That\'s it}.',
        '{Same-day|Immediate} payment {options|available}: {e-transfer, cash, or certified cheque|bank transfer, cash, or cheque} — {your choice|you decide}. {Most {{CITY}} sellers|Sellers in your area} {prefer|choose} {e-transfer|instant bank transfer} for {speed|convenience}. We {accommodate|process} {all payment methods|every option} at {no extra charge|no additional cost}.',
        'Our {{CITY}} {pickup zone|service area} includes {all major neighbourhoods|every part of the city} — {from the core to the suburbs|city-wide coverage}. {No extra charge|Free service} for {any location|all areas} within {{CITY}}. {We come to you|On-site service} wherever your {{MODEL}} is {parked|located}.',
        '{Hundreds of|Thousands of} {{CITY}} {residents|car owners} have {used|chosen} We Buy Cars to {sell their {{MODEL}}|offload their vehicle} — {without listing|no Kijiji required}, {without dealers|no trade-in needed}, and {without stress|completely hassle-free}. {Join them|Be next} and {get your offer|find out what your car is worth} today.',
        'We {never ask you to|won\'t require you to} {move the car|transport the vehicle} to a {lot|inspection point|dealership}. Our {{CITY}} {team|appraisers} {come to you|visit your address} — {home, work, or storage|wherever the car is}. {Your {{MODEL}} stays put|The vehicle doesn\'t move} until {we arrive|our team gets there}.',
        '{Quick, clean, legal|Fast, fair, local}. Our {{CITY}} {vehicle purchases|car buys} are {fully compliant|legally complete} with {Ontario MTO requirements|provincial transfer law}. You {get|receive} a {proper receipt|official transfer document} and {we handle|we file} the {ownership change|registration update} with the {MTO|ministry}.',
        'We Buy Cars {covers|operates in} {{CITY}} {and the surrounding area|with a local team}. {Response times|Pickup windows} are {among the fastest|the quickest} in {Ontario|the GTA} — {because we\'re local|our drivers are based nearby}, not {dispatching from|coming from} {across the province|far away}.',
        '{Your {{CONDITION}} {{MODEL}}|The vehicle} {doesn\'t need|doesn\'t require} {cleaning|detailing|repairs} before {our visit|pickup}. We {buy vehicles as-is|assess them as they sit} — {no prep needed|no cleaning required}, {no repairs expected|no work necessary}. {Just|Simply} have the {ownership document|UVIP and ownership} {ready|available}.',
    ],
    p3: [
        'A {{CONDITION}} {{MODEL}} in {{CITY}} typically {fetches|sells for} {$PRICERANGE} depending on {year, trim, mileage|condition and service history}. {Newer models|Vehicles} with {complete maintenance records|full service history} {consistently attract|always receive} the {highest|top} offers. Use the {60-second form|contact button} above to get your {personalised|exact} number.',
        'The {{MODEL}} {holds|maintains} {strong|excellent} resale value in the Ontario market — a direct {benefit|advantage} for you as a seller. Our appraisers {cross-reference|compare} {live auction results|real transaction data}, {dealer wholesale benchmarks|independent valuations}, and {recent {{CITY}}-area|local} {private sales|transactions} to calculate the {most competitive|strongest} offer.',
        'Pricing a {{CONDITION}} {{MODEL}} in {{CITY}} accurately is the difference between a {fast sale|quick deal} and {a prolonged listing|weeks of waiting}. Our offer is {calibrated against|based on} {actual GTA transactions|real Ontario sales} from the past {30 days|30–60 days} — so you receive {fair market value|current market price} today.',
        '{{CITY}} sellers who come {directly to|straight to} We Buy Cars {consistently receive|regularly get} {15–25%|significantly} more than {dealer trade-in|dealership} quotes for the same vehicle. That {gap|difference} exists because dealerships {build reconditioning margins|add profit buffers} into every offer. {Selling directly|Going direct} means that {margin stays with you|money comes to you}.',
        'Every {{CONDITION}} {{MODEL}} we assess is {priced individually|valued specifically} — not based on {broad condition categories|general estimates}. {Year, exact mileage|Model year, odometer}, {service records|maintenance history}, {trim level|package}, {optional features|added equipment}, and {current {{CITY}} demand|local market conditions} all feed into your {final number|offer}.',
        'Don\'t let {uncertainty|questions} about price {stop you|prevent you} from selling. Our {60-second form|instant quote} gives you a {real offer range|genuine estimate} based on {current Ontario market data|live {{CITY}} transactions} for the {{MODEL}} — {no personal information required|no commitment needed} until you {choose to proceed|decide to sell}.',
        'We\'ve {bought|purchased} {over 2,400|thousands of} vehicles across Ontario. {{CITY}} sellers {repeatedly tell us|consistently say} we {outbid|beat} the competition — not because we {cut corners|compromise on quality}, but because our {direct-purchase|cash-buying} model {removes|eliminates} the {middleman costs|dealer markups} that {eat into|reduce} {trade-in offers|other quotes}.',
        'Current Ontario {resale data|market data} puts the {{MODEL}} in {strong|high} demand among {both retail and wholesale|all types of} buyers. That {competition|demand} directly {benefits|helps} you: our offer {reflects|is based on} what buyers are {actually paying|genuinely spending} in {{CITY}} {right now|this week}, not what a dealer {hopes to profit|expects to make} after resale.',
        'In {{YEAR}}, {{CONDITION}} {{MODEL}} {values|prices} in {{CITY}} {range from|typically fall between} {$PRICERANGE}. {Vehicles|Cars} with {complete service records|full documentation} and {accident-free history|clean Carfax} attract {the strongest|top-dollar} offers from {our buyer network|we buy cars}. {Get your number|Find out yours} in {60 seconds|under a minute}.',
        '{Market data|Transaction records} shows the {{MODEL}} is {one of the most|among the top} {actively sold|frequently traded} vehicles in {{CITY}}. {This means|That translates to} {multiple buyers|several purchasers} competing for {each available unit|every available car} — which {drives|pushes} our {offer higher|prices up} for {sellers like you|{{CITY}} residents}.',
        'Our {{CITY}} offer for your {{CONDITION}} {{MODEL}} is {backed by|supported with} {real transaction data|actual sales records} from {Ontario wholesale auctions|GTA dealer networks} — {updated weekly|refreshed regularly}. You receive a {current|up-to-date} number, not {last quarter\'s|outdated} {estimates|averages}.',
        '{$PRICERANGE} is the {current|{{YEAR}}} {range|value band} for {{CONDITION}} {{MODEL}} in {{CITY}} based on {our purchase data|recent transactions}. {Your specific number|The exact offer} depends on {year, mileage, and trim|individual vehicle details} — {submit your details|use the form} and {we\'ll give you|get} the {exact figure|precise number} in {60 seconds|minutes}.',
        'The {{MODEL}} {commands|achieves} {strong|above-average} {wholesale prices|cash values} in {{CITY}} {because|due to} {high local demand|a large buyer base} and {limited supply|low available inventory}. {Our network|We Buy Cars} {pays more|offers more} than {standard dealers|most buyers} because we {sell directly|access wholesale channels} without the {reconditioning costs|middleman margin}.',
        '{Unsure|Not sure} what your {{CONDITION}} {{MODEL}} is worth in {{CITY}}? {Our tool|The 60-second form} {gives you|provides} a {real estimate|genuine range} — {$PRICERANGE for this model|based on current Ontario data}. {No sign-up|No account required}, {no commitment|zero obligation}, {no sales pressure|just an honest number}.',
        'We Buy Cars {tracks|monitors} {live Ontario auction results|real-time GTA transactions} to {price your {{MODEL}}|value your vehicle} accurately in {{CITY}}. {Unlike|Compared to} {book-value tools|online estimate sites}, our {offers|quotes} {reflect|capture} {current local demand|what buyers are paying right now} — {not|rather than} {national averages|generalized estimates}.',
        '{Your {{MODEL}}\'s|The} {resale value|market price} in {{CITY}} is {influenced by|affected by} {local demand, seasonal trends|supply, demand, and timing}, and {recent comparable sales|nearby transactions}. Our {{YEAR}} data for {{CITY}} puts {clean, low-mileage|well-maintained} {{MODEL}} units at {the top of|the strongest end of} the {offer range|price spectrum}.',
        'The {Ontario|Canadian} {used vehicle|pre-owned car} market in {{YEAR}} is {favouring|rewarding} {sellers|owners} of {popular models|in-demand vehicles} like the {{MODEL}}. {{{CITY}} specifically|Your market} {shows|reflects} {above-average|strong} {buyer activity|purchase interest} — {which means|translating to} {stronger offers|better prices} from {our network|We Buy Cars}.',
        '{Getting a|Receiving an} {honest|accurate} {value assessment|price estimate} for your {{CONDITION}} {{MODEL}} in {{CITY}} {shouldn\'t require|doesn\'t need} {a dealer visit|an appointment}. {Our 60-second process|The instant form} {delivers|gives you} a {real number|genuine cash value} based on {{{CITY}} area transactions|local Ontario data} — {fast and obligation-free|no strings attached}.',
        'We {don\'t use|never apply} {national book values|generic pricing tools} to price your {{MODEL}} in {{CITY}}. {Local resale data|Real transaction history} from {{CITY}} and the {GTA|surrounding area} {drives|determines} every offer we make. That {local precision|area-specific pricing} is why {our quotes|We Buy Cars offers} {consistently beat|are higher than} {online estimates|what other buyers offer}.',
        '{Condition, year, and mileage|Your vehicle\'s specifics} all {factor into|affect} the {final offer|cash value} for your {{MODEL}} in {{CITY}}. A {{{CONDITION}} unit|vehicle in your condition} with {average mileage|typical kilometres} {currently attracts|is worth} {$PRICERANGE on the open market|strong buyer interest in Ontario}. {Our offer|What we pay} is {typically within|usually at} the {top range|higher end} of that {band|spectrum}.',
        'We Buy Cars {has paid out|has transferred} {millions of dollars|significant sums} to {{CITY}} {and GTA|and Ontario} sellers since {launching|we started}. The {{MODEL}} is one of our {top 5 most purchased|most frequently bought} {models|vehicles} in {{{CITY}}|your area} — {our offers reflect that volume|we price it competitively because we buy so many}.',
        '{Real sellers|Actual customers} in {{CITY}} have received {offers of|payments of} {$PRICERANGE} for {{CONDITION}} {{MODEL}} through {We Buy Cars|our service}. {Your exact offer|The precise number} depends on {individual vehicle details|your specific car} — {submit the form|call us} to get {your personalised quote|an exact number} in {60 seconds|under a minute}.',
        'The {gap|difference} between {trade-in|dealer} offers and {private sale|direct sale} values for the {{MODEL}} in {{CITY}} is {typically 15–25%|often thousands of dollars}. {We Buy Cars|Our offer} {sits at|is positioned at} the {top of|strongest end of} that range — {because we access|by reaching} {the same wholesale buyers|the real market} that {dealers sell to|dealerships use} after {reconditioning|repairs}.',
        '{Fast, fair, final|Clear, honest, immediate}. Our {offer for|quote on} your {{CONDITION}} {{MODEL}} in {{CITY}} is {valid|honoured} {at pickup|when we arrive} — {no changes|no adjustments}, {no surprises|no last-minute reductions}. {What we say|What we quote} is {what we pay|what you receive}.',
        '{Selling in winter|Selling off-season|Timing your sale} {doesn\'t reduce|won\'t lower} our offer. {We Buy Cars|Our team} purchases {{MODEL}} vehicles in {{CITY}} {year-round|all year} at {consistent|stable} {market rates|cash values}. {Seasonal demand fluctuations|Market timing} {affect private listings|slow down Kijiji}, not {our offers|what we pay}.',
        'Our {{CITY}} {purchase data|transaction records} for {{CONDITION}} {{MODEL}} {shows|indicates} {strong|solid} {year-over-year|ongoing} demand. {In {{YEAR}}|Currently}, {buyers in our network|our purchasers} are {paying|offering} {$PRICERANGE|strong prices} for {this model|the {{MODEL}}} — {get your offer|find out your number} before {conditions change|the market shifts}.',
        '{Sellers of|Owners with} {{CONDITION}} {{MODEL}} in {{CITY}} {are getting|are receiving} {stronger offers|more cash} right now. {Supply is limited|Inventory is tight}, which {means|translates to} We Buy Cars {can offer|is able to pay} {stronger prices|more money} {right now|this week} than {in typical market conditions|during slower periods}.',
        'The {{MODEL}} in {{CONDITION}} condition {carries|retains} {real wholesale value|strong cash value} in {{CITY}}. {Even with|Despite} {higher mileage|visible wear|cosmetic damage}, our {buyer network|appraisers} {recognise|know} the {underlying value|market worth} — {you\'ll be surprised|most sellers are pleasantly surprised} {by the offer|at what we can pay}.',
        '{{{CITY}}-specific|Local} {pricing data|market intelligence} for the {{MODEL}} {shows|reveals} {average offers of|typical values around} {$PRICERANGE for {{CONDITION}} condition|strong prices for this model in your area}. We Buy Cars {uses this data|applies this intelligence} to {make our offers|price your vehicle} — {ensuring you get|so you receive} a {fair, locally-calibrated|market-accurate} {number|amount}.',
        '{Before you accept|Don\'t accept} any offer, {compare|check} it against {what We Buy Cars|our quote} {can offer|will pay} for your {{CONDITION}} {{MODEL}} in {{CITY}}. {Our offers|We consistently} {beat|exceed} {dealer trade-ins|other buyer quotes} by {15–25%|a significant margin} — {because we pay|by paying} {wholesale rates direct|market prices directly} to the {seller|owner}.',
    ],
    market: [
        'The Ontario {pre-owned|used} vehicle market is currently {favouring|rewarding} sellers of {{CONDITION}} {{MODEL}} units. {GTA dealer|Regional} inventory remains {below historical averages|tight}, pushing {wholesale and retail|both types of} buyers toward {direct-purchase|private} transactions.',
        'Demand for {{CONDITION}} vehicles in {{CITY}} is {consistently strong|particularly high} across all seasons. The {{MODEL}} {ranks among|is one of} the most {sought-after|in-demand} units in Ontario — valued for its {reliability|durability}, {running costs|efficiency}, and {broad appeal|wide buyer base}.',
        'Used car values in {{CITY}} and the {broader GTA|surrounding area} are {holding firm|remaining strong}. {Rising financing rates|Higher borrowing costs} have pushed {more Ontario buyers|GTA purchasers} toward {purchasing outright|cash transactions} — increasing demand for {well-priced|competitively offered} vehicles like your {{MODEL}}.',
        'The {{MODEL}} {consistently performs|regularly achieves} well at {Ontario wholesale|GTA} auctions and in {private resale channels|direct sales}. Our {buyer network|purchasing team} {monitors|tracks} {live transaction data|real sales results} {weekly|regularly}, so your {{CITY}} offer {reflects|captures} {real current demand|actual buyer activity}.',
        'We Buy Cars\' {pricing model|valuation system} is built around {real transaction velocity|actual sales speed}, not {listed asking prices|advertised values}. We {track|monitor} what {{CONDITION}} {{MODEL}} vehicles are {actually selling for|genuinely fetching} in {{CITY}} and across the GTA — and we {pass that value|deliver that price} directly to you.',
        'Selling a {{CONDITION}} {{MODEL}} in {{CITY}} {puts you in|gives you} an {advantageous|strong} position. Local demand is {supported by|driven by} {independent dealers, fleet operators|a wide buyer base} and {private resellers|wholesalers} competing for {available inventory|vehicles like yours}.',
        'Ontario\'s used vehicle market is one of the {most liquid|most active} in Canada — especially in {{CITY}} and the {GTA corridor|surrounding area}. Selling your {{CONDITION}} {{MODEL}} through We Buy Cars {benefits from|receives} {immediate cash offers|instant payment}, which is why we {commit to|offer} {same-day offers|quick quotes} and {same-day payment|fast payment}.',
        'Market conditions in {{CITY}} {continue to reward|currently favour} sellers who {act quickly|sell directly}. {Interest rate pressure|Higher financing costs} {have tightened|are squeezing} dealer {profit margins|returns}, making our {direct-to-seller|cash-purchase} model {more attractive|more competitive} than ever.',
        'In {{YEAR}}, {{CITY}} automotive {market trends|industry data} show the {{MODEL}} {maintaining|holding} {strong resale|above-average cash} values. {GTA-wide|Ontario-wide} {auction results|transaction records} for {this model|the {{MODEL}}} {confirm|show} {consistent|stable} {buyer demand|purchase interest} from {multiple buyer segments|various purchasers}.',
        '{Seasonal demand fluctuations|Market cycles} {affect private listings|slow Kijiji} but {don\'t impact|rarely influence} what We Buy Cars pays for your {{MODEL}} in {{CITY}}. Our {year-round|all-season} {purchasing activity|buying operations} mean {consistent offers|stable prices} {regardless of|no matter the} {time of year|season}.',
        'The {{CITY}} {used vehicle|pre-owned car} market in {{YEAR}} {reflects|shows} {tight inventory|low supply} for {popular models|in-demand vehicles} like the {{MODEL}}. {This supply pressure|That scarcity} {drives|pushes} our {purchase offers|cash prices} {higher|up}, {benefiting|helping} sellers who {act now|move quickly}.',
        '{Our purchase data|We Buy Cars\' transaction records} for {{CITY}} shows the {{MODEL}} {is one of|ranks as} {our most frequently purchased|a top-traded} vehicle in {{YEAR}}. {That volume|The buying frequency} {means|translates to} {our pricing is accurate|we know this model well} and {our offers reflect|our quotes capture} {real local demand|what the market actually pays}.',
        '{GTA and {{CITY}}|Ontario} {used vehicle|pre-owned car} {prices|values} for the {{MODEL}} {have remained|are holding} {strong|firm} through {{YEAR}}. {Multiple factors|Several market forces} — {low new car inventory|supply chain impacts}, {high financing costs|interest rates}, and {rising fuel efficiency demand|preference for reliable vehicles} — all {support|maintain} {strong cash values|high resale prices} for {sellers|owners}.',
        'We Buy Cars {monitors|tracks} {Ontario-wide|GTA-focused} {auction results|resale transactions} {weekly|in real time}. The {{MODEL}} {consistently fetches|regularly achieves} {strong prices|above-average values} across {all condition categories|every condition tier} — {our {{CITY}} offers|what we pay in your area} {reflect that data|are based on this intelligence}.',
        '{The {{CITY}} market for|In {{CITY}}, demand for} {{CONDITION}} {{MODEL}} {vehicles|units} is {particularly strong|especially active} {right now|in {{YEAR}}}. {Competing buyers|Multiple purchasers} from {our wholesale network|the GTA market} are {bidding on|interested in} {this exact model|cars like yours} — {which means|and that means} {stronger offers|more cash} for {{CITY}} {sellers|owners}.',
        '{Ontario\'s|Canada\'s} {pre-owned vehicle|used car} market {is one of|remains} {the most liquid|highly active} in North America. {{CITY}} sits at {the centre of|within} the {most active|strongest} {regional market|buying zone} — {GTA demand|buyer activity} for the {{MODEL}} {supports|enables} We Buy Cars to {make strong offers|pay competitive prices} {year-round|consistently}.',
        'The {post-pandemic|current} {Ontario used car|GTA pre-owned vehicle} market {continues to|still} favour {direct sellers|private sellers} over {trade-in|dealership} transactions. {Dealers|Franchised dealerships} are {tightening margins|reducing trade-in budgets} — which {increases|widens} the {advantage|gap} of {selling directly|going direct} through We Buy Cars.',
        '{Market analysts|Industry data} {indicate|show} the {{MODEL}} is {expected to|projected to} {maintain|hold} {strong resale values|high cash prices} through {the remainder of {{YEAR}}|the coming months} in {{CITY}}. {Now|This period} is {an ideal|a strong} {time|moment} to {sell|cash out} — before {seasonal shifts|market changes} {affect|alter} {pricing|values}.',
        'We Buy Cars {purchases|acquires} {{CONDITION}} {{MODEL}} {vehicles|units} across {{CITY}} at {market-rate|competitive} {cash prices|values}. Our {buyer network|wholesale connections} {spans|covers} {all of Ontario|the GTA and beyond}, {ensuring|guaranteeing} that the {offer you receive|price we pay} {reflects|captures} {the broadest possible|maximum} {buyer demand|market interest}.',
        '{Strong demand|Active buying interest} for {{CONDITION}} {{MODEL}} in {{CITY}} {is being driven|comes from} by {a combination of|several factors including} {low dealer inventory|tight supply}, {high used-vehicle demand|strong buyer activity}, and {continued{{CITY}} population growth|ongoing Ontario urbanization}. {That demand|This activity} {directly translates|converts} into {stronger cash offers|more money} for {you|sellers}.',
        'The {{MODEL}} {has consistently ranked|continues to appear} {among the top|in the top 10} {most-sold|highest-value} vehicles {sellers cash in|owners sell} in {{{CITY}}|Ontario} for {multiple consecutive years|several years running}. {Sustained|Ongoing} {seller activity|cash transactions} means {We Buy Cars|our team} can {reliably offer|consistently pay} {strong cash values|competitive prices} {regardless of|across all} {condition|vehicle state}.',
        '{{{CITY}}\'s|Ontario\'s} {automotive resale|vehicle selling} market {in {{YEAR}}|currently} {shows|displays} {resilience|strength} across {most vehicle categories|popular models}. The {{MODEL}}, as a {high-demand|well-regarded} {model|vehicle}, {benefits from|receives} {above-average seller returns|strong cash offers} — {which We Buy Cars|and we} {leverage|use} to {make you|offer you} {stronger offers|more competitive prices}.',
        '{We track|Our team monitors} {live Ontario auction|real-time GTA wholesale} {results|data} to {ensure|guarantee} our {{CITY}} offers for the {{MODEL}} {stay current|remain up-to-date}. {Unlike|Compared to} {static book values|outdated pricing tools}, our {offers|quotes} {move with|reflect} the {real market|actual buyer activity} — {updated|refreshed} {weekly|every few days}.',
        '{The {{CITY}} market|In your area}, {{CONDITION}} {{MODEL}} {vehicles|cars} are {selling faster|moving more quickly} than the {Ontario average|provincial norm} in {{YEAR}}. {Buyer competition|Purchase demand} for {this specific model|the {{MODEL}}} is {elevated|high}, which {allows|enables} We Buy Cars to {extend|make} {stronger|more competitive} {offers|cash prices} to {{{CITY}} sellers|owners like you}.',
        '{Economic conditions|Market forces} in {{YEAR}} {have created|generate} {a strong|an ideal} {seller\'s market|selling environment} for {{CONDITION}} {{MODEL}} {owners|sellers} in {{CITY}}. {Cash buyers|Direct purchasers} like We Buy Cars {are actively competing|compete directly} for {available inventory|vehicles like yours} — {get your offer|find out what we\'ll pay} before {conditions shift|the market changes}.',
        'The {Ontario|Canadian} {used vehicle|pre-owned car} market {continues|remains} {active|strong} in {{CITY}} through {{YEAR}}. {Models like the {{MODEL}}|The {{MODEL}}} {attract|receive} {consistent|steady} {buyer interest|purchase demand} from {multiple market segments|various buyer types} — {all of which|all contributing to} {We Buy Cars|us being able} to {pay|offer} {competitive|strong} {cash prices|amounts} in {{CITY}}.',
        '{Supply constraints|Limited inventory} for the {{MODEL}} {in {{CITY}}|across the GTA} {mean|translate to} {buyers are competing|strong buyer competition} for {available units|vehicles like yours}. {We Buy Cars|Our team} {taps into|accesses} that {wholesale demand|buyer competition} directly — and {the result|that demand} is {a stronger offer|more cash} for you as the {seller|owner}.',
        '{Our market intelligence|We Buy Cars\' data} for {{CITY}} {shows|indicates} {{CONDITION}} {{MODEL}} {values|prices} {averaging|typically reaching} {$PRICERANGE in {{YEAR}}|strong levels currently}. {This range|These values} {reflects|captures} {real buyer behaviour|actual transaction data}, not {theoretical estimates|generic online tools}.',
        '{Regardless of|No matter the} {{{CITY}}\'s seasonal|Ontario\'s market} {fluctuations|cycles}, We Buy Cars {maintains|offers} {consistent|stable} {purchase prices|cash offers} for the {{MODEL}}. {Our wholesale network|The buyers in our network} {purchases year-round|buys in all seasons} — {meaning your offer|so your price} {doesn\'t depend on|isn\'t affected by} {timing|when you sell}.',
        '{{{CITY}}\'s|Ontario\'s} {most active|busiest} {period for used car|time for pre-owned vehicle} {transactions|sales} {aligns|coincides} with {current market conditions|right now in {{YEAR}}}. {This is|Now is} {a favourable time|an ideal moment} for {{CONDITION}} {{MODEL}} {sellers|owners} in {{CITY}} to {receive strong offers|get top dollar} — {contact|call} We Buy Cars {today|now}.',
    ],
    local: [
        'Our {appraisal and pickup|assessment and collection} service covers {all of {{CITY}}|{{CITY}} city-wide} and the {full GTA|entire Greater Toronto Area} — including Toronto, Mississauga, Brampton, Vaughan, Markham, Scarborough, Etobicoke, North York, Oakville, Burlington, Richmond Hill, Newmarket, Aurora, Barrie, and King City. {Seven days a week|Every day}, {evenings included|including evenings}, at no charge.',
        'Selling your {{MODEL}} in {{CITY}} is {straightforward|simple} with our {local team|on-the-ground team}. We {dispatch within 2–4 hours|arrive quickly} after offer confirmation, {complete all MTO transfer|handle all Ontario} paperwork on-site, and {pay immediately|transfer funds} at pickup. Most {{CITY}} transactions {wrap up in|take} under 30 minutes.',
        'We\'ve processed {thousands of|countless} vehicle purchases across {{CITY}} and {surrounding Ontario communities|nearby areas}. Our {drivers|appraisers} know the area, {arrive on schedule|are punctual}, and {carry|bring} full MTO documentation for {an immediate|instant} ownership transfer. You provide the {keys and the signed ownership|vehicle and documents} — we handle everything else.',
        'For {{CITY}} residents, our service {removes|eliminates} every {logistical|practical} barrier to selling. {No transport|No driving}, {no prep|no cleaning}, {no paperwork research|no form research} required. We {come to your {{CITY}} address|visit you}, verify the {{MODEL}}, confirm the price, and {pay before we leave|transfer funds immediately}.',
        'Our {{CITY}} coverage is {comprehensive|complete} — from the {city centre|downtown core} to {surrounding neighbourhoods|suburbs} and {commuter areas|outlying zones}. We {don\'t charge extra|never add fees} for {distance|location} within our {service zone|coverage area}, and we {never ask you to|won\'t make you} meet us at a {lot|depot}.',
        'Being {local|area-based} means we understand {{CITY}} {seller priorities|what sellers want}: {speed, fair value|quick sale, top dollar}, and no {hassle|complications}. Our team is {trained|equipped} to {complete|finish} the full transaction — {appraisal, paperwork, payment|assessment, transfer, cash} — in {a single visit|one appointment}.',
        'Our presence across {{CITY}} and the GTA means {no long wait times|fast dispatch} and {no out-of-area|no distant} dispatching. We {keep local appraisers|have team members} {active in your area|stationed nearby} so when you accept an offer, {response time|pickup time} is measured in {hours|a few hours} — not days.',
        'Whether you\'re selling from a {residential address|home}, a {condo parking garage|apartment complex}, or a {commercial lot|workplace parking} in {{CITY}}, our team {adapts to|handles} your situation. We\'ve {handled|completed} pickups in {every type of|all kinds of} {location|setting} across Ontario.',
        'We Buy Cars {operates|runs} a {dedicated|full-time} {{{CITY}} pickup team|local collection fleet} — {not contractors|not freelancers}, but {our own|in-house} {licensed appraisers|trained buyers} who {know {{CITY}}|are familiar with your area}. {Local expertise|Area knowledge} means {faster dispatch|quicker arrivals} and {accurate, market-specific|locally-calibrated} {offers|pricing}.',
        '{{{CITY}} is one of|Your city is among} {our most active|our busiest} {service areas|markets}. {Our appraisers visit {{CITY}}|We send a team to your area} {daily|multiple times a week} — {which means|so} {shorter wait times|quicker appointments} and {more competitive offers|stronger prices} for {local sellers|{{CITY}} residents} like you.',
        'The entire {MTO ownership transfer|Ontario ownership change} process {happens|takes place} {at your {{CITY}} address|during our visit} — {no ServiceOntario visit required|no government office trip needed}. Our {licensed|certified} {team|appraisers} {bring|carry} {all forms|every document} and {guide you through|explain} the {one-page signing|single signature} process. {It takes about 5 minutes|Very quick}.',
        'We Buy Cars {has completed|has conducted} {vehicle purchases|transactions} in {every neighbourhood|all parts of} {{CITY}}. From {established residential areas|quiet suburbs} to {busy commercial streets|urban centres}, our {team|drivers} {navigate|know} {{CITY}} {efficiently|well} — {arriving on time|punctual arrivals} every {appointment|time}.',
        '{Our {{CITY}} team|We Buy Cars {{CITY}}|Our local appraisers} {are available|operate} {7 days a week|every day of the week}, from {8am to 8pm|early morning to evening}. {Evening and weekend appointments|Off-hours slots} {are available at no extra charge|come with no premium} — because {we know|we understand that} {{CITY}} residents {have|lead} {busy lives|demanding schedules}.',
        '{Getting to your {{CITY}} address|Reaching your location} is {never a problem|always straightforward} for our team. {Whether you\'re in|From} {central {{CITY}}|the city core} to the {outskirts|farthest suburbs}, we {dispatch from nearby|have appraisers close by} to {minimise|reduce} {travel time|wait time} and {arrive faster|get there sooner}.',
        'We {don\'t just serve|go beyond just} {{CITY}} proper — our {coverage extends|service reaches} to {nearby communities|surrounding areas} {including|such as} {adjacent cities and towns|neighbouring municipalities}. If your {{MODEL}} is {located just outside {{CITY}}|slightly beyond city limits}, {call us|contact us} — {we\'ll likely|we can usually} {still come to you|cover your location}.',
        '{{{CITY}} sellers|Local residents who sell to We Buy Cars} {consistently rate|regularly give us} {our service highly|5-star feedback} for {speed and professionalism|fast, honest service}. {Our {{CITY}} team|We Buy Cars} {prides itself on|is committed to} {arriving on time|punctuality}, {paying as quoted|honouring our offers}, and {leaving the seller|ensuring you\'re} {fully satisfied|completely happy}.',
        'We {buy all makes and models|purchase every type of vehicle} in {{CITY}} — not just the {{MODEL}}. {Our network|We Buy Cars} {covers|handles} {everything from daily drivers|all vehicles from economy cars} to {luxury vehicles|high-end models} and {commercial vehicles|trucks and vans}. {The {{MODEL}} is particularly in demand|Your {{MODEL}} is a model we actively seek} in {{{CITY}}|your area}.',
        '{Payment methods|How we pay} in {{CITY}}: {e-transfer (instant), cash, or certified cheque|bank transfer, cash, or official cheque} — your choice, {processed at pickup|completed on the spot}. {Most {{CITY}} sellers|The majority of our clients} {choose|prefer} {e-transfer|bank transfer} for {immediate funds availability|instant access}. {All methods|Every option} are {available|offered} at {no extra cost|zero additional charge}.',
        'We Buy Cars {maintains|keeps} a {local presence|team presence} in {{CITY}} {specifically|intentionally} to {serve|support} {{CITY}} {residents|sellers} with {fast, local service|quick, area-specific help}. {We\'re not dispatching from|Our drivers don\'t come from} {Toronto|another city} — {we\'re {based nearby|in your area}|our appraisers work locally}, which means {shorter response times|quicker arrivals} and {better knowledge|deeper understanding} of {{{CITY}} market values|your area\'s prices}.',
        '{{{CITY}}-based|Local {{CITY}}} sellers {save time|benefit} {significantly|considerably} by {choosing We Buy Cars|selling to us} over {private listing|going on Kijiji}. {No viewings|Zero showings}, {no strangers|no unknown buyers}, {no trips to ServiceOntario|no government office visits} — just {one visit from our team|a single appointment}, {one signature|one signing}, and {one payment|your money}.',
        '{Hundreds of {{CITY}}|Many local} {sellers|residents} have {used|chosen} We Buy Cars in the {past year|recent months}. {Word of mouth|Referrals} in {{CITY}} {is strong|keep us busy} — {sellers tell their neighbours|customers recommend us} because {the experience is genuinely easy|we deliver what we promise}. {Join them|Be next} — {it takes 60 seconds|the form takes under a minute} to {get started|find out your offer}.',
        'The {{{CITY}} service area|area around {{CITY}}} we cover {includes|encompasses} {the full municipality|all of {{CITY}}} plus {surrounding communities|nearby towns}. {Our dispatch team|We Buy Cars operations} in {{CITY}} {runs continuously|operates without interruption} — {no blackout periods|available all hours} during {our 8am–8pm|standard operating} {hours|window}, {seven days a week|every day}.',
        '{We\'re familiar with|Our team knows} {{{CITY}} traffic patterns|{{CITY}}\'s road network}, {parking situations|where to park}, and {property types|building types} — {from houses to condos|residential and commercial}. {This means|That experience means} {our appraisers|our team} {arrive without issues|show up smoothly} and {complete the pickup|handle the collection} {efficiently|without complications}.',
        '{Our {{CITY}} guarantee|What we promise {{CITY}} sellers}: {the offer quoted is the offer paid|we honour our quotes}, {we arrive on time|punctual every time}, {all paperwork is handled by us|no forms for you to research}, and {payment is immediate|you\'re paid before we leave}. {Simple, local, professional|Fast, fair, and fully local}.',
        '{No matter|Regardless of} {where in {{CITY}}|which part of {{CITY}}} you are, We Buy Cars {will come to you|can reach you}. Our {{{CITY}} team|local appraisers} {know every neighbourhood|are familiar with all areas} — {from the city centre|from {{CITY}}\'s core} to {the edges of the municipality|outlying zones}. {Free pickup|Complimentary collection} {every time|always included}.',
        '{{{CITY}} is a key|Your city is a priority} {market for us|service area}. We {invest|put resources} in {maintaining|keeping} a {strong local presence|dedicated local team} in {{CITY}} because {it\'s one of our|it\'s a} {most active buying areas|high-volume purchase zones}. {That investment|Our local focus} {directly benefits|helps} sellers through {faster pickup|quicker arrivals} and {more competitive pricing|stronger offers}.',
        'We Buy Cars {is committed to|prioritises} {serving {{CITY}}|{{CITY}} residents} with {the best possible|top-quality} {service and pricing|experience and offers}. {Our local {{CITY}} team|We Buy Cars {{CITY}}} {handles|manages} {every transaction|all purchases} personally — {not call centres|direct service}, {not third-party agents|no outsourcing}, {just our own appraisers|just our trained team} {at your door|at your location}.',
        '{We\'ve served|We Buy Cars has assisted} {{CITY}} {sellers|car owners} for {years|a significant period}, {building|earning} a {reputation|name} for {honest, fast|straightforward, quick} {vehicle purchases|car buying}. {Our {{CITY}} track record|Our local history} speaks for itself: {thousands of transactions|many completed sales}, {all completed as quoted|every one paid as promised}.',
        '{Same-day pickup|Immediate collection} is {standard|the norm} in {{CITY}} — {not an upcharge|included in our offer}. {Submit the form|Call us}, {confirm your offer|accept the quote}, {and we\'ll be there|and our team will arrive} {within hours|same day}. {{{CITY}} sellers|You} {shouldn\'t|don\'t need to} {wait days|wait long} to {sell|get paid for} a vehicle in {this market|{{YEAR}}}.',
        'Our {{{CITY}} pickup record|on-time arrival rate} in {{CITY}} is {above 97%|exceptional}. {We show up when we say we will|Punctuality is a priority} — {because we know|since we understand} {{CITY}} {sellers\' time is valuable|residents are busy}. {If anything changes|Should any issue arise}, {we notify you in advance|you\'re informed immediately}.',
    ],
};

function spin(pool, slug, offset) {
    offset = offset || 0;
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
        hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
    }
    return pool[(hash + offset) % pool.length];
}

// ── Dynamic price range per condition ─────────────────────────────────────
const priceRanges = {
    'used':              '$4,500 – $18,000',
    'accident damaged':  '$1,200 – $8,500',
    'high mileage':      '$2,000 – $10,000',
    'needs repairs':     '$1,500 – $9,000',
    'not running':       '$800 – $5,500',
    'clean title':       '$5,000 – $22,000',
    'cosmetic damage':   '$2,500 – $11,000',
    'mechanical issues': '$1,000 – $7,500',
    'scrap':             '$300 – $2,500',
};

function applySpins(raw, page, existingFiles) {
    const YEAR = new Date().getFullYear();
    const priceRange = priceRanges[page.condition] || '$2,000 – $15,000';

    // Internal city links: 5 other cities, same model + condition — ONLY if page exists
    const condSlug  = toSlug(page.condition);
    const modelSlug = toSlug(page.model);
    const otherCities = locations
        .filter(l => l !== page.location)
        .filter(c => {
            if (!existingFiles) return false;
            const citySlug = toSlug(c);
            return [...existingFiles].some(f => f.includes(modelSlug) && f.endsWith(`-in-${citySlug}.html`));
        })
        .slice(0, 5);
    const internalLinks = otherCities
        .map(c => {
            const citySlug = toSlug(c);
            const file = [...existingFiles].find(f => f.includes(modelSlug) && f.endsWith(`-in-${citySlug}.html`)) || '#';
            return `<a href="/${file}" style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 14px;font-size:.8rem;font-weight:600;color:#374151">${c}</a>`;
        })
        .join('\n        ');

    // Breadcrumb schema
    const breadcrumb = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home',      item: `${DOMAIN}/` },
            { '@type': 'ListItem', position: 2, name: page.condition.charAt(0).toUpperCase() + page.condition.slice(1) + ' Cars', item: `${DOMAIN}/cash-for-${condSlug}-cars.html` },
            { '@type': 'ListItem', position: 3, name: page.model,  item: `${DOMAIN}/cash-for-${condSlug}-${modelSlug}-in-toronto.html` },
            { '@type': 'ListItem', position: 4, name: page.location, item: `${DOMAIN}/${page.slug}` },
        ]
    });
    const breadcrumbTag = `<script type="application/ld+json">${breadcrumb}<\/script>`;

    // LocalBusiness / Service schema
    const localSchema = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': ['AutoDealer', 'LocalBusiness'],
        name: 'We Buy Cars',
        description: `We buy ${page.condition} ${page.model} in ${page.location} for top dollar. Same-day cash offer and free on-site pickup.`,
        url: `${DOMAIN}/${page.slug}`,
        telephone: '+14376004968',
        priceRange: priceRange,
        areaServed: {
            '@type': 'City',
            name: page.location,
            addressRegion: 'ON',
            addressCountry: 'CA'
        },
        address: {
            '@type': 'PostalAddress',
            addressLocality: page.location,
            addressRegion: 'ON',
            addressCountry: 'CA'
        },
        openingHoursSpecification: {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
            opens: '08:00',
            closes: '20:00'
        },
        aggregateRating: {
            '@type': 'AggregateRating',
            'ratingValue': '4.9',
            'reviewCount': String(113 + (Math.abs(page.slug.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 80)),
            'bestRating': '5',
            'worstRating': '1'
        },
        sameAs: [`${DOMAIN}/`]
    });
    const localSchemaTag = `<script type="application/ld+json">${localSchema}<\/script>`;

    // FAQ schema (unique per condition)
    const faqSchema = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
            {
                '@type': 'Question',
                name: `How much can I get for my ${page.condition} ${page.model} in ${page.location}?`,
                acceptedAnswer: { '@type': 'Answer', text: `Based on current ${page.location} market data, a ${page.condition} ${page.model} typically sells for ${priceRange}. We provide a free, no-obligation offer in 60 seconds — call (437) 600-4968 or submit the form.` }
            },
            {
                '@type': 'Question',
                name: `How fast can I sell my ${page.model} in ${page.location}?`,
                acceptedAnswer: { '@type': 'Answer', text: `We Buy Cars completes most transactions the same day. You submit your details, receive a confirmed cash offer by phone, and we arrange on-site pickup and payment — often within hours.` }
            },
            {
                '@type': 'Question',
                name: `Do you buy ${page.condition} ${page.model} vehicles with high mileage or damage?`,
                acceptedAnswer: { '@type': 'Answer', text: `Yes. We buy all conditions — running or not, high mileage, minor accidents, or cosmetic wear. Our offer reflects real ${page.location} wholesale values, not penalised trade-in rates.` }
            }
        ]
    });
    const faqSchemaTag = `<script type="application/ld+json">${faqSchema}<\/script>`;

    // Meta description
    const metaDesc = `Sell your ${page.condition} ${page.model} in ${page.location} for top dollar. We Buy Cars offers instant cash (${priceRange}), same-day payment, and on-site appraisal. Get your offer in 60 seconds.`;

    // Spin text blocks then resolve inline {a|b|c} choices
    let hash = 0;
    for (let i = 0; i < page.slug.length; i++) hash = (hash * 31 + page.slug.charCodeAt(i)) >>> 0;

    function spinAndResolve(pool, offset) {
        let text = spin(pool, page.slug, offset);
        // Replace {{PLACEHOLDER}} vars BEFORE inlineSpin so {all of {{CITY}}|...}
        // doesn't get mangled — {{CITY}} must become "Toronto" first
        text = text
            .replace(/\{\{MODEL\}\}/g,      page.model)
            .replace(/\{\{CITY\}\}/g,       page.location)
            .replace(/\{\{CONDITION\}\}/g,  page.condition)
            .replace(/\{\{YEAR\}\}/g,       String(YEAR))
            .replace(/\$PRICERANGE/g,       priceRange)
            .replace(/\{\{PRICERANGE\}\}/g, priceRange);
        return inlineSpin(text, hash + offset);
    }

    return raw
        .replace(/\{\{SPIN_TITLE\}\}/g,          spinAndResolve(spinPool.title,   6))
        .replace(/\{\{SPIN_HEADING\}\}/g,        spinAndResolve(spinPool.heading, 0))
        .replace(/\{\{SPIN_P1\}\}/g,              spinAndResolve(spinPool.p1,      1))
        .replace(/\{\{SPIN_P2\}\}/g,              spinAndResolve(spinPool.p2,      2))
        .replace(/\{\{SPIN_P3\}\}/g,              spinAndResolve(spinPool.p3,      3))
        .replace(/\{\{SPIN_MARKET\}\}/g,          spinAndResolve(spinPool.market,  4))
        .replace(/\{\{SPIN_LOCAL\}\}/g,           spinAndResolve(spinPool.local,   5))
        .replace(/\{\{MODEL\}\}/g,                page.model)
        .replace(/\{\{CITY\}\}/g,                 page.location)
        .replace(/\{\{CONDITION\}\}/g,            page.condition)
        .replace(/\{\{TITLE\}\}/g,                page.title)
        .replace(/\{\{SLUG\}\}/g,                 page.slug)
        .replace(/\{\{YEAR\}\}/g,                 String(YEAR))
        .replace(/\{\{PRICERANGE\}\}/g,           priceRange)
        .replace(/\$PRICERANGE/g,                 priceRange)
        .replace(/\{\{META_DESCRIPTION\}\}/g,     metaDesc)
        .replace(/\{\{CANONICAL_URL\}\}/g,        `${DOMAIN}/${page.slug}`)
        .replace(/\{\{BREADCRUMB_SCHEMA\}\}/g,    breadcrumbTag)
        .replace(/\{\{LOCAL_SCHEMA\}\}/g,         localSchemaTag + '\n  ' + faqSchemaTag)
        .replace(/\{\{INTERNAL_CITY_LINKS\}\}/g,  internalLinks);
}

// ── Generate batch ─────────────────────────────────────────────────────────
// Step 1: write new pages first (so they appear in dist for link building)
let generated = 0;
for (const page of batch) {
    const html = applySpins(template, page, null);
    fs.writeFileSync(path.join(DIST_DIR, page.slug), html, 'utf8');
    generated++;
}

// Step 2: build static blocks based on ALL files now in dist (including this batch)
const staticTemplate = buildStaticBlocks();
const existingFiles = new Set(fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.html')));

// Step 3: rewrite this batch with correct links (only to existing pages)
for (const page of batch) {
    const html = applySpins(staticTemplate, page, existingFiles);
    fs.writeFileSync(path.join(DIST_DIR, page.slug), html, 'utf8');
}

// Step 4: render anchor pages that were pre-created as empty files
for (const page of anchorPages) {
    const filePath = path.join(DIST_DIR, page.slug);
    // Only render if content is empty (placeholder) or not in this batch
    const current = fs.readFileSync(filePath, 'utf8');
    if (current.length < 100) {
        const html = applySpins(staticTemplate, page, existingFiles);
        fs.writeFileSync(filePath, html, 'utf8');
    }
}

// ── Save state ─────────────────────────────────────────────────────────────
const newState = {
    lastIndex      : endIndex - 1,
    totalGenerated : state.totalGenerated + generated,
    lastRunAt      : new Date().toISOString(),
    totalCombinations: TOTAL,
    remaining      : TOTAL - endIndex,
};
fs.writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2), 'utf8');

console.log(`✅  Generated ${generated} pages.`);
console.log(`📦  Total generated so far: ${newState.totalGenerated} / ${TOTAL}`);
console.log(`⏭   Next run starts at index: ${endIndex} (${newState.remaining} remaining)`);

// ── Update sitemap (chunked at 10k, with sitemap-index.xml) ───────────────
console.log('\n📍  Updating sitemaps...');
// Only include full pages (>5KB) to exclude stub/anchor pages from sitemap
const distFiles = fs.readdirSync(DIST_DIR).filter(f => {
    if (!f.endsWith('.html')) return false;
    if (['links-hub.html', 'index.html', '404.html'].includes(f)) return false;
    const size = fs.statSync(path.join(DIST_DIR, f)).size;
    return size > 5000;
});

// Build URL list: homepage first, then pages
const allUrls = [
    { loc: `${DOMAIN}/`, priority: '1.0' },
    ...distFiles.map(f => ({ loc: `${DOMAIN}/${f}`, priority: '0.7' })),
];

const CHUNK_SIZE = 10000;
const chunks = [];
for (let i = 0; i < allUrls.length; i += CHUNK_SIZE) {
    chunks.push(allUrls.slice(i, i + CHUNK_SIZE));
}

// Write individual sitemap files
for (let ci = 0; ci < chunks.length; ci++) {
    const fname = ci === 0 ? 'sitemap.xml' : `sitemap-${ci + 1}.xml`;
    const fpath = path.join(DIST_DIR, fname);
    const entries = chunks[ci].map(u =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ).join('\n');
    fs.writeFileSync(fpath, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`, 'utf8');
}

// Write sitemap-index.xml
const sitemapIndexEntries = chunks.map((_, ci) => {
    const fname = ci === 0 ? 'sitemap.xml' : `sitemap-${ci + 1}.xml`;
    return `  <sitemap>\n    <loc>${DOMAIN}/${fname}</loc>\n  </sitemap>`;
}).join('\n');
fs.writeFileSync(
    path.join(DIST_DIR, 'sitemap-index.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapIndexEntries}\n</sitemapindex>\n`,
    'utf8'
);

// Write robots.txt
fs.writeFileSync(
    path.join(DIST_DIR, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${DOMAIN}/sitemap-index.xml\n`,
    'utf8'
);

console.log(`✅  ${chunks.length} sitemap file(s) + sitemap-index.xml + robots.txt written (${allUrls.length} URLs total)`);

// ── Update links-hub.html (crawler entry point) ────────────────────────────
console.log('🔗  Updating links-hub.html...');
const linkItems = distFiles
    .filter(f => f !== 'links-hub.html')
    .map(f => `  <li><a href="${DOMAIN}/${f}">${f.replace(/-/g, ' ').replace('.html', '')}</a></li>`)
    .join('\n');

const linksHubHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex,nofollow">
  <title>All Pages — We Buy Cars</title>
  <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px}h1{color:#1e293b}ul{column-count:3;column-gap:24px;list-style:none;padding:0}li{margin-bottom:6px;break-inside:avoid}a{color:#2563eb;font-size:.85rem;text-decoration:none}a:hover{text-decoration:underline}@media(max-width:600px){ul{column-count:1}}</style>
</head>
<body>
  <h1>Ontario Car Buyer — All Pages</h1>
  <p>Total: <strong>${distFiles.length}</strong> pages indexed</p>
  <ul>
${linkItems}
  </ul>
</body>
</html>`;

fs.writeFileSync(LINKS_HUB, linksHubHtml, 'utf8');
console.log(`✅  links-hub.html updated — ${distFiles.length} links`);

// index.html = лучшая посадочная страница (Toronto + Honda Civic + used)
const INDEX_PATH = path.join(DIST_DIR, 'index.html');
const indexCandidates = [
    'cash-for-used-honda-civic-in-toronto.html',
    'cash-for-used-toyota-camry-in-toronto.html',
    'cash-for-used-honda-accord-in-toronto.html',
];
const indexSource = indexCandidates.find(f => fs.existsSync(path.join(DIST_DIR, f)));
if (indexSource) {
    fs.copyFileSync(path.join(DIST_DIR, indexSource), INDEX_PATH);
    console.log(`🏠 index.html created from ${indexSource}`);
} else if (fs.existsSync(LINKS_HUB)) {
    fs.copyFileSync(LINKS_HUB, INDEX_PATH);
    console.log('🏠 index.html created from links-hub (fallback)');
}

// ── Generate 404.html ──────────────────────────────────────────────────────
const page404 = path.join(DIST_DIR, '404.html');
fs.writeFileSync(page404, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <title>Page Not Found — We Buy Cars</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex flex-col">
  <!-- Header -->
  <header class="bg-gray-900 text-white py-4">
    <div class="max-w-5xl mx-auto px-4 flex items-center justify-between">
      <a href="/" class="text-xl font-bold tracking-tight">We Buy Cars</a>
      <a href="tel:+14376004968" class="text-green-400 font-semibold text-sm">(437) 600-4968</a>
    </div>
  </header>

  <!-- Main -->
  <main class="flex-1 flex items-center justify-center px-4 py-16">
    <div class="max-w-lg w-full text-center">
      <div class="text-8xl font-black text-gray-200 mb-4">404</div>
      <h1 class="text-3xl font-bold text-gray-900 mb-3">Page Not Found</h1>
      <p class="text-gray-600 mb-8">The page you're looking for doesn't exist or may have moved. We're still here to buy your car — just call or request a callback.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <button onclick="document.getElementById('modal404').classList.remove('hidden')"
          class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-lg transition-colors">
          📞 Request Callback
        </button>
        <a href="/" class="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 px-8 rounded-lg text-lg transition-colors">
          ← Back to Home
        </a>
      </div>
      <p class="mt-6 text-sm text-gray-500">Or call us directly: <a href="tel:+14376004968" class="text-green-600 font-semibold">(437) 600-4968</a></p>
    </div>
  </main>

  <!-- Callback Modal -->
  <div id="modal404" class="hidden fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 relative">
      <button onclick="document.getElementById('modal404').classList.add('hidden')"
        class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
      <h2 class="text-2xl font-bold text-gray-900 mb-1">Get Your Free Quote</h2>
      <p class="text-gray-500 text-sm mb-6">We'll call you back within 15 minutes.</p>
      <input id="trap404" name="website" type="text" style="display:none" tabindex="-1" autocomplete="off">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
          <input id="name404" type="text" placeholder="John Smith"
            class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
          <input id="phone404" type="tel" placeholder="(416) 555-0100" oninput="fmt404(this)"
            class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
          <p id="err404" class="hidden text-red-500 text-xs mt-1">Please enter a valid 10-digit phone number.</p>
        </div>
        <button onclick="send404()" class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg transition-colors">
          Request Callback
        </button>
      </div>
      <p id="ok404" class="hidden text-green-600 font-semibold text-center mt-4">✅ We'll call you shortly!</p>
    </div>
  </div>

  <footer class="bg-gray-900 text-gray-400 text-center py-4 text-sm">
    &copy; ${new Date().getFullYear()} We Buy Cars. Ontario, Canada.
  </footer>

  <script>
    function fmt404(el) {
      const d = el.value.replace(/\\D/g,'').slice(0,10);
      if(d.length<=3) el.value=d; else if(d.length<=6) el.value='('+d.slice(0,3)+') '+d.slice(3); else el.value='('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6);
    }
    function send404() {
      if(document.getElementById('trap404').value){return;}
      const ph=document.getElementById('phone404').value.replace(/\\D/g,'');
      if(ph.length!==10){document.getElementById('err404').classList.remove('hidden');return;}
      document.getElementById('err404').classList.add('hidden');
      const name=document.getElementById('name404').value.trim()||'(no name)';
      fetch('https://api.telegram.org/bot8455897525:AAHO7mHpOHzW2AvRArGCY5LtYcHe2EHx3Rw/sendMessage',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:'848972882',text:'📞 404 callback\\nName: '+name+'\\nPhone: +1'+ph+'\\nPage: '+location.href})
      });
      document.getElementById('ok404').classList.remove('hidden');
      setTimeout(()=>document.getElementById('modal404').classList.add('hidden'),2000);
    }
  </script>
</body>
</html>
`, 'utf8');
console.log('🔴  404.html generated');