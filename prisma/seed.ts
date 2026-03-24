// ═══════════════════════════════════════════════════════════════
// SIRREEL — DATABASE SEED (Planyo Migration)
// Run with: npx prisma db seed
// ═══════════════════════════════════════════════════════════════

import { PrismaClient, UserRole, AssetStatus, Location, Region, ClientTier, ProductionType, DriverType, PersonRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚛 Seeding SirReel database...\n');

  // ═══ 1. USERS (SirReel Team — 7 people) ═══
  console.log('👤 Creating users...');
  const users = await Promise.all([
    prisma.user.create({ data: { email: 'wes@sirreel.com', name: 'Wes', role: UserRole.ADMIN, location: Location.CHESTNUT } }),             // Owner / Super Admin
    prisma.user.create({ data: { email: 'dani@sirreel.com', name: 'Dani Novoa', role: UserRole.ADMIN, location: Location.CHESTNUT } }),      // COO / Admin — runs day-to-day
    prisma.user.create({ data: { email: 'hugo@sirreel.com', name: 'Hugo', role: UserRole.MANAGER, location: Location.CHESTNUT } }),           // Warehouse & Fleet Manager + Dispatch
    prisma.user.create({ data: { email: 'julian@sirreel.com', name: 'Julian', role: UserRole.MANAGER, location: Location.CHESTNUT } }),       // Fleet Director
    prisma.user.create({ data: { email: 'jose@sirreel.com', name: 'Jose Pacheco', role: UserRole.AGENT, phone: '818-515-2389', location: Location.CHESTNUT } }), // Agent
    prisma.user.create({ data: { email: 'oliver@sirreel.com', name: 'Oliver Carlson', role: UserRole.AGENT, location: Location.CHESTNUT } }),  // Agent
    prisma.user.create({ data: { email: 'christian@sirreel.com', name: 'Christian DeAngelis', role: UserRole.AGENT, location: Location.CHESTNUT } }), // Billing & Admin
  ]);

  const agentMap: Record<string, string> = {};
  users.forEach(u => { agentMap[u.name.split(' ')[0]] = u.id; });

  // ═══ 2. ASSET CATEGORIES (from Planyo resources.csv) ═══
  console.log('🚛 Creating asset categories...');
  const categories = await Promise.all([
    prisma.assetCategory.create({ data: { name: 'Cube Truck', slug: 'cube-truck', totalUnits: 41, dailyRate: 175, weeklyRate: 875, region: Region.LA, planyoResourceId: 116560, sortOrder: 1 } }),
    prisma.assetCategory.create({ data: { name: 'Cargo Van w/ Liftgate', slug: 'cargo-van-liftgate', totalUnits: 30, dailyRate: 200, region: Region.LA, planyoResourceId: 117102, sortOrder: 2 } }),
    prisma.assetCategory.create({ data: { name: 'Cargo Van w/o Liftgate', slug: 'cargo-van-no-liftgate', totalUnits: 8, dailyRate: 150, region: Region.LA, planyoResourceId: 117105, sortOrder: 3 } }),
    prisma.assetCategory.create({ data: { name: 'Passenger Van', slug: 'passenger-van', totalUnits: 10, dailyRate: 175, region: Region.LA, planyoResourceId: 117158, sortOrder: 4 } }),
    prisma.assetCategory.create({ data: { name: 'PopVan', slug: 'popvan', totalUnits: 9, dailyRate: 400, region: Region.LA, planyoResourceId: 117155, sortOrder: 5 } }),
    prisma.assetCategory.create({ data: { name: 'Camera Cube', slug: 'camera-cube', totalUnits: 7, dailyRate: 200, region: Region.LA, planyoResourceId: 117156, sortOrder: 6 } }),
    prisma.assetCategory.create({ data: { name: 'DLUX', slug: 'dlux', totalUnits: 4, dailyRate: 450, region: Region.LA, planyoResourceId: 119962, sortOrder: 7 } }),
    prisma.assetCategory.create({ data: { name: 'DLUX (NorCal)', slug: 'dlux-norcal', totalUnits: 4, dailyRate: 450, region: Region.NORCAL, planyoResourceId: 224971, sortOrder: 8 } }),
    prisma.assetCategory.create({ data: { name: 'ProScout / VTR', slug: 'proscout-vtr', totalUnits: 3, dailyRate: 450, region: Region.LA, planyoResourceId: 117159, sortOrder: 9 } }),
    prisma.assetCategory.create({ data: { name: 'Stakebed', slug: 'stakebed', totalUnits: 3, dailyRate: 200, region: Region.LA, planyoResourceId: 117160, sortOrder: 10 } }),
    prisma.assetCategory.create({ data: { name: 'Scissor Lift', slug: 'scissor-lift', totalUnits: 4, dailyRate: 0, region: Region.LA, planyoResourceId: 217515, sortOrder: 11 } }),
    prisma.assetCategory.create({ data: { name: 'Studios', slug: 'studios', totalUnits: 10, dailyRate: 3000, region: Region.LA, planyoResourceId: 128064, sortOrder: 12, description: 'Lankershim & Lima stages. Standing sets: hospital, police, morgue.' } }),
    prisma.assetCategory.create({ data: { name: 'UTAH Vehicles', slug: 'utah-vehicles', totalUnits: 8, dailyRate: 150, region: Region.UTAH, planyoResourceId: 234184, sortOrder: 13 } }),
  ]);

  const catMap: Record<string, string> = {};
  categories.forEach(c => { catMap[c.slug] = c.id; });

  // ═══ 3. COMPANIES & CONTACTS (from Planyo users.csv) ═══
  console.log('👥 Creating people, companies & affiliations...');

  // ═══ PEOPLE (the real clients — UPMs, producers, coordinators) ═══
  const peopleData = [
    { first: 'Terry', last: 'Meadows', email: 'rentals@cinepowerlight.com', phone: '818-846-0123', role: PersonRole.UPM, tier: ClientTier.VIP, agent: 'Jose', bookings: 45, spend: 87500, notes: 'Major account. Always needs cubes + cargo. Fast turnaround.' },
    { first: 'Justin', last: 'Kappenstein', email: 'jtkappenstein@gmail.com', phone: '610-733-5834', role: PersonRole.PRODUCER, tier: ClientTier.VIP, agent: 'Oliver', bookings: 75, spend: 142000, notes: 'Highest booking count. Feature films, very organized.' },
    { first: 'Nathan', last: 'Israel', email: 'nathan.israel@me.com', phone: '562-708-4444', role: PersonRole.UPM, tier: ClientTier.VIP, agent: 'Jose', bookings: 64, spend: 118000, notes: 'TV series work. Repeat client, prefers cargo vans.' },
    { first: 'Elli', last: 'Legerski', email: 'elli.legerski@gmail.com', phone: '719-406-8300', role: PersonRole.PRODUCER, tier: ClientTier.PREFERRED, agent: 'Jose', bookings: 38, spend: 64200, notes: 'Branded content. Uses PopVans heavily.' },
    { first: 'Brandon', last: 'McClover', email: 'brandon.ajrfilms@gmail.com', phone: '323-921-6504', role: PersonRole.PRODUCER, tier: ClientTier.PREFERRED, agent: 'Jose', bookings: 21, spend: 38500, notes: 'Music videos. Quick bookings, usually 1-2 day rentals.' },
    { first: 'Alyssa', last: 'Benedetto', email: 'alycancreate@gmail.com', phone: '516-458-7846', role: PersonRole.PRODUCER, tier: ClientTier.PREFERRED, agent: 'Jose', bookings: 24, spend: 41000, notes: 'Photo shoots & commercials. Consistent booker.' },
    { first: 'Stephen', last: 'Predisik', email: 's.predisik@gmail.com', phone: '310-975-4462', role: PersonRole.UPM, tier: ClientTier.PREFERRED, agent: 'Oliver', bookings: 32, spend: 54000, notes: 'Feature films. Reliable. Should follow up for spring projects.' },
    { first: 'Nathalie', last: 'Sar Shalom', email: 'natspfilm@gmail.com', phone: '818-825-2861', role: PersonRole.PRODUCER, tier: ClientTier.PREFERRED, agent: 'Oliver', bookings: 17, spend: 28400, notes: 'AFI projects. Uses Lankershim standing sets frequently.' },
    { first: 'Beth', last: 'Schiffman', email: 'bschiffman@icloud.com', phone: '818-599-1267', role: PersonRole.UPM, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 12, spend: 22000, notes: "TV pilots. Haven't heard from her since December." },
    { first: 'Alex', last: 'Fymat', email: 'afymat@yahoo.com', phone: '323-493-1011', role: PersonRole.PRODUCER, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 11, spend: 19500, notes: 'Went quiet in November. Was a regular.' },
    { first: 'Maddie', last: 'Harmon', email: 'madharmon96@gmail.com', phone: '602-748-0393', role: PersonRole.PRODUCER, tier: ClientTier.STANDARD, agent: 'Dani', bookings: 10, spend: 16800, notes: 'Documentaries. Camera cubes.' },
    { first: 'Taylor', last: 'Woods', email: 'taylor.rose.woods@gmail.com', phone: '347-401-3357', role: PersonRole.PRODUCTION_COORDINATOR, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 9, spend: 15200, notes: "Commercials. Hasn't booked in a while." },
    { first: 'Bethel', last: 'Teshome', email: 'bethel.teshome18@gmail.com', phone: '562-688-7392', role: PersonRole.PRODUCER, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 9, spend: 14500, notes: 'Music videos. Lost touch — need to re-engage.' },
    { first: 'Jason', last: 'Mayfield', email: 'jason@snowstory.com', phone: '817-874-2259', role: PersonRole.PRODUCER, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 5, spend: 12600, notes: 'Music videos. Likes DLUX trailers for talent.' },
    { first: 'Laura', last: 'DuBois', email: 'laura@thewildfactory.com', phone: '516-241-1371', role: PersonRole.PRODUCTION_COORDINATOR, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 4, spend: 7200, notes: 'Scout vans mostly.' },
    { first: 'Jason', last: 'Friedman-Mendez', email: 'jason@jaykatproductions.com', phone: '917-755-5002', role: PersonRole.PRODUCER, tier: ClientTier.STANDARD, agent: 'Jose', bookings: 4, spend: 6800, notes: 'Growing account. Short films, expanding to features.' },
    { first: 'Neka', last: 'Berrian', email: 'neka.berrian@gmail.com', phone: '323-590-2379', role: PersonRole.PRODUCER, tier: ClientTier.STANDARD, agent: 'Dani', bookings: 4, spend: 5800, notes: 'Indie films.' },
    { first: 'Ella', last: 'Swanstrom', email: 'ESwanstrom@fabletics.com', phone: '503-871-6121', role: PersonRole.PRODUCTION_COORDINATOR, tier: ClientTier.NEW, agent: 'Jose', bookings: 0, spend: 0, notes: 'New client. Spring campaign inquiry. Big potential — studio + fleet.' },
  ];

  const personMap: Record<string, string> = {};
  for (const p of peopleData) {
    const person = await prisma.person.create({
      data: {
        firstName: p.first,
        lastName: p.last,
        email: p.email,
        phone: p.phone,
        role: p.role,
        tier: p.tier,
        assignedAgentId: agentMap[p.agent] || undefined,
        totalSpend: p.spend,
        totalBookings: p.bookings,
        notes: p.notes,
      }
    });
    personMap[p.email] = person.id;
  }

  // ═══ COMPANIES (the check payers — production companies) ═══
  const companyData = [
    { name: 'Cinepower & Light', type: ProductionType.COMMERCIAL, spend: 87500, bookings: 45 },
    { name: 'Justin K Productions', type: ProductionType.FILM, spend: 142000, bookings: 75 },
    { name: 'Nathan Israel Prod', type: ProductionType.TV, spend: 118000, bookings: 64 },
    { name: 'Elli Legerski Prod', type: ProductionType.COMMERCIAL, spend: 64200, bookings: 38 },
    { name: 'AJR Films', type: ProductionType.MUSIC_VIDEO, spend: 38500, bookings: 21 },
    { name: 'Nathalie SP Film', type: ProductionType.FILM, spend: 28400, bookings: 17 },
    { name: 'Snow Story Media', type: ProductionType.MUSIC_VIDEO, spend: 12600, bookings: 5 },
    { name: 'Wild Factory', type: ProductionType.COMMERCIAL, spend: 7200, bookings: 4 },
    { name: 'JayKat Productions', type: ProductionType.FILM, spend: 6800, bookings: 4 },
    { name: 'Fabletics', type: ProductionType.COMMERCIAL, spend: 0, bookings: 0 },
    { name: 'Beth Schiffman Prod', type: ProductionType.TV, spend: 22000, bookings: 12 },
    { name: 'Alex Fymat Prod', type: ProductionType.FILM, spend: 19500, bookings: 11 },
    { name: 'Maddie Harmon Prod', type: ProductionType.FILM, spend: 16800, bookings: 10 },
    { name: 'Alyssa Benedetto Prod', type: ProductionType.COMMERCIAL, spend: 41000, bookings: 24 },
    { name: 'Stephen Predisik Films', type: ProductionType.FILM, spend: 54000, bookings: 32 },
    { name: 'Taylor Woods Prod', type: ProductionType.COMMERCIAL, spend: 15200, bookings: 9 },
    { name: 'Bethel Teshome Prod', type: ProductionType.MUSIC_VIDEO, spend: 14500, bookings: 9 },
    { name: 'Neka Berrian Prod', type: ProductionType.FILM, spend: 5800, bookings: 4 },
    // Companies that multiple people have worked for
    { name: 'Netflix', type: ProductionType.TV, spend: 45000, bookings: 8 },
    { name: 'Paramount Pictures', type: ProductionType.FILM, spend: 38000, bookings: 6 },
    { name: 'HBO / Max', type: ProductionType.TV, spend: 22000, bookings: 4 },
  ];

  const companyMap: Record<string, string> = {};
  for (const c of companyData) {
    const company = await prisma.company.create({
      data: {
        name: c.name,
        industry: c.type,
        totalSpend: c.spend,
        totalBookings: c.bookings,
      }
    });
    companyMap[c.name] = company.id;
  }

  // ═══ AFFILIATIONS (connects people to companies per production) ═══
  const affiliationData = [
    // Terry Meadows works across multiple companies
    { email: 'rentals@cinepowerlight.com', company: 'Cinepower & Light', production: 'Spring Auto Campaign', spend: 52000 },
    { email: 'rentals@cinepowerlight.com', company: 'Netflix', production: 'Stranger Things S5', spend: 25000 },
    { email: 'rentals@cinepowerlight.com', company: 'Paramount Pictures', production: 'MI: Dead Reckoning P2', spend: 10500 },
    // Justin K works across companies
    { email: 'jtkappenstein@gmail.com', company: 'Justin K Productions', production: 'Midnight Run 2', spend: 82000 },
    { email: 'jtkappenstein@gmail.com', company: 'Paramount Pictures', production: 'Untitled Thriller', spend: 28000 },
    { email: 'jtkappenstein@gmail.com', company: 'Netflix', production: 'Glass Onion 3', spend: 20000 },
    { email: 'jtkappenstein@gmail.com', company: 'HBO / Max', production: 'White Lotus S4', spend: 12000 },
    // Nathan Israel
    { email: 'nathan.israel@me.com', company: 'Nathan Israel Prod', production: 'Lights Out S3', spend: 78000 },
    { email: 'nathan.israel@me.com', company: 'HBO / Max', production: 'Industry S4', spend: 10000 },
    { email: 'nathan.israel@me.com', company: 'Netflix', production: 'Unknown Project', spend: 30000 },
    // Stephen Predisik — multiple companies
    { email: 's.predisik@gmail.com', company: 'Stephen Predisik Films', production: 'Feature — The Last Mile', spend: 32000 },
    { email: 's.predisik@gmail.com', company: 'Paramount Pictures', production: 'Untitled Drama', spend: 22000 },
    // Others — single company each for now
    { email: 'elli.legerski@gmail.com', company: 'Elli Legerski Prod', production: null, spend: 64200 },
    { email: 'brandon.ajrfilms@gmail.com', company: 'AJR Films', production: null, spend: 38500 },
    { email: 'alycancreate@gmail.com', company: 'Alyssa Benedetto Prod', production: null, spend: 41000 },
    { email: 'natspfilm@gmail.com', company: 'Nathalie SP Film', production: null, spend: 28400 },
    { email: 'bschiffman@icloud.com', company: 'Beth Schiffman Prod', production: null, spend: 22000 },
    { email: 'afymat@yahoo.com', company: 'Alex Fymat Prod', production: null, spend: 19500 },
    { email: 'madharmon96@gmail.com', company: 'Maddie Harmon Prod', production: null, spend: 16800 },
    { email: 'taylor.rose.woods@gmail.com', company: 'Taylor Woods Prod', production: null, spend: 15200 },
    { email: 'bethel.teshome18@gmail.com', company: 'Bethel Teshome Prod', production: null, spend: 14500 },
    { email: 'jason@snowstory.com', company: 'Snow Story Media', production: null, spend: 12600 },
    { email: 'laura@thewildfactory.com', company: 'Wild Factory', production: null, spend: 7200 },
    { email: 'jason@jaykatproductions.com', company: 'JayKat Productions', production: null, spend: 6800 },
    { email: 'neka.berrian@gmail.com', company: 'Neka Berrian Prod', production: null, spend: 5800 },
    { email: 'ESwanstrom@fabletics.com', company: 'Fabletics', production: 'Spring Campaign', spend: 0 },
  ];

  for (const a of affiliationData) {
    if (personMap[a.email] && companyMap[a.company]) {
      await prisma.affiliation.create({
        data: {
          personId: personMap[a.email],
          companyId: companyMap[a.company],
          productionName: a.production,
          totalSpend: a.spend,
          totalBookings: a.spend > 0 ? Math.max(1, Math.floor(a.spend / 3000)) : 0,
        }
      });
    }
  }

  // ═══ 4. INTERNAL DRIVERS ═══
  console.log('🚗 Creating drivers...');
  await prisma.driver.create({ data: { firstName: 'Hugo', lastName: 'Fleet', type: DriverType.INTERNAL, totalCheckouts: 0, notes: 'Warehouse & Fleet Manager. Handles dispatch and fleet transport.' } });

  // ═══ DONE ═══
  const counts = {
    users: await prisma.user.count(),
    categories: await prisma.assetCategory.count(),
    people: await prisma.person.count(),
    companies: await prisma.company.count(),
    affiliations: await prisma.affiliation.count(),
    drivers: await prisma.driver.count(),
  };

  console.log('\n✅ Seed complete!');
  console.log(`   ${counts.users} users`);
  console.log(`   ${counts.categories} asset categories`);
  console.log(`   ${counts.people} people (UPMs, producers, coordinators)`);
  console.log(`   ${counts.companies} companies`);
  console.log(`   ${counts.affiliations} affiliations (people ↔ companies)`);
  console.log(`   ${counts.drivers} drivers`);
  console.log('\n🚀 Ready to start Phase 1!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
