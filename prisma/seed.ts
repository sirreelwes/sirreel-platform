// ═══════════════════════════════════════════════════════════════
// SIRREEL — DATABASE SEED (Planyo Migration)
// Run with: npx prisma db seed
// ═══════════════════════════════════════════════════════════════

import { PrismaClient, UserRole, AssetStatus, Location, Region, ClientTier, ProductionType, DriverType } from '@prisma/client';

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
  console.log('👥 Creating companies & contacts...');

  const clientData = [
    { company: 'Cinepower & Light', first: 'Terry', last: 'Meadows', email: 'rentals@cinepowerlight.com', phone: '818-846-0123', bookings: 45, spend: 87500, type: ProductionType.COMMERCIAL, tier: ClientTier.VIP, agent: 'Jose' },
    { company: 'Justin K Productions', first: 'Justin', last: 'Kappenstein', email: 'jtkappenstein@gmail.com', phone: '610-733-5834', bookings: 75, spend: 142000, type: ProductionType.FILM, tier: ClientTier.VIP, agent: 'Oliver' },
    { company: 'Nathan Israel Prod', first: 'Nathan', last: 'Israel', email: 'nathan.israel@me.com', phone: '562-708-4444', bookings: 64, spend: 118000, type: ProductionType.TV, tier: ClientTier.VIP, agent: 'Jose' },
    { company: 'Elli Legerski Prod', first: 'Elli', last: 'Legerski', email: 'elli.legerski@gmail.com', phone: '719-406-8300', bookings: 38, spend: 64200, type: ProductionType.COMMERCIAL, tier: ClientTier.PREFERRED, agent: 'Jose' },
    { company: 'AJR Films', first: 'Brandon', last: 'McClover', email: 'brandon.ajrfilms@gmail.com', phone: '323-921-6504', bookings: 21, spend: 38500, type: ProductionType.MUSIC_VIDEO, tier: ClientTier.PREFERRED, agent: 'Jose' },
    { company: 'JayKat Productions', first: 'Jason', last: 'Friedman-Mendez', email: 'jason@jaykatproductions.com', phone: '917-755-5002', bookings: 4, spend: 6800, type: ProductionType.FILM, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Nathalie SP Film', first: 'Nathalie', last: 'Sar Shalom', email: 'natspfilm@gmail.com', phone: '818-825-2861', bookings: 17, spend: 28400, type: ProductionType.FILM, tier: ClientTier.PREFERRED, agent: 'Oliver' },
    { company: 'Taylor Woods Prod', first: 'Taylor', last: 'Woods', email: 'taylor.rose.woods@gmail.com', phone: '347-401-3357', bookings: 9, spend: 15200, type: ProductionType.COMMERCIAL, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Snow Story Media', first: 'Jason', last: 'Mayfield', email: 'jason@snowstory.com', phone: '817-874-2259', bookings: 5, spend: 12600, type: ProductionType.MUSIC_VIDEO, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Alyssa Benedetto', first: 'Alyssa', last: 'Benedetto', email: 'alycancreate@gmail.com', phone: '516-458-7846', bookings: 24, spend: 41000, type: ProductionType.COMMERCIAL, tier: ClientTier.PREFERRED, agent: 'Jose' },
    { company: 'Maddie Harmon Prod', first: 'Maddie', last: 'Harmon', email: 'madharmon96@gmail.com', phone: '602-748-0393', bookings: 10, spend: 16800, type: ProductionType.FILM, tier: ClientTier.STANDARD, agent: 'Dani' },
    { company: 'Wild Factory', first: 'Laura', last: 'DuBois', email: 'laura@thewildfactory.com', phone: '516-241-1371', bookings: 4, spend: 7200, type: ProductionType.COMMERCIAL, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Beth Schiffman Prod', first: 'Beth', last: 'Schiffman', email: 'bschiffman@icloud.com', phone: '818-599-1267', bookings: 12, spend: 22000, type: ProductionType.TV, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Alex Fymat Prod', first: 'Alex', last: 'Fymat', email: 'afymat@yahoo.com', phone: '323-493-1011', bookings: 11, spend: 19500, type: ProductionType.FILM, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Fabletics', first: 'Ella', last: 'Swanstrom', email: 'ESwanstrom@fabletics.com', phone: '503-871-6121', bookings: 0, spend: 0, type: ProductionType.COMMERCIAL, tier: ClientTier.NEW, agent: 'Jose' },
    { company: 'Stephen Predisik', first: 'Stephen', last: 'Predisik', email: 's.predisik@gmail.com', phone: '310-975-4462', bookings: 32, spend: 54000, type: ProductionType.FILM, tier: ClientTier.PREFERRED, agent: 'Oliver' },
    { company: 'Bethel Teshome', first: 'Bethel', last: 'Teshome', email: 'bethel.teshome18@gmail.com', phone: '562-688-7392', bookings: 9, spend: 14500, type: ProductionType.MUSIC_VIDEO, tier: ClientTier.STANDARD, agent: 'Jose' },
    { company: 'Neka Berrian', first: 'Neka', last: 'Berrian', email: 'neka.berrian@gmail.com', phone: '323-590-2379', bookings: 4, spend: 5800, type: ProductionType.FILM, tier: ClientTier.STANDARD, agent: 'Dani' },
  ];

  for (const c of clientData) {
    const company = await prisma.company.create({
      data: {
        name: c.company,
        industry: c.type,
        tier: c.tier,
        totalSpend: c.spend,
        totalBookings: c.bookings,
        defaultAgentId: agentMap[c.agent] || undefined,
      }
    });

    await prisma.contact.create({
      data: {
        companyId: company.id,
        firstName: c.first,
        lastName: c.last,
        email: c.email,
        phone: c.phone,
        isPrimary: true,
      }
    });
  }

  // ═══ 4. INTERNAL DRIVERS ═══
  console.log('🚗 Creating drivers...');
  await prisma.driver.create({ data: { firstName: 'Hugo', lastName: 'Fleet', type: DriverType.INTERNAL, totalCheckouts: 0, notes: 'Warehouse & Fleet Manager. Handles dispatch and fleet transport.' } });

  // ═══ DONE ═══
  const counts = {
    users: await prisma.user.count(),
    categories: await prisma.assetCategory.count(),
    companies: await prisma.company.count(),
    contacts: await prisma.contact.count(),
    drivers: await prisma.driver.count(),
  };

  console.log('\n✅ Seed complete!');
  console.log(`   ${counts.users} users`);
  console.log(`   ${counts.categories} asset categories`);
  console.log(`   ${counts.companies} companies`);
  console.log(`   ${counts.contacts} contacts`);
  console.log(`   ${counts.drivers} drivers`);
  console.log('\n🚀 Ready to start Phase 1!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
