import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Get category IDs
  const cats = await prisma.assetCategory.findMany()
  const catMap: Record<string, string> = {}
  cats.forEach(c => { catMap[c.name] = c.id })

  const getCat = (name: string) => {
    const id = catMap[name]
    if (!id) throw new Error(`Category not found: ${name}`)
    return id
  }

  const assets = [
    // ─── Cargo Vans w/ Liftgate ───
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 20', year: 2015, make: 'Ford', model: 'Transit Cargo', mileage: 98396 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 21', year: 2015, make: 'Ford', model: 'Transit Cargo', mileage: 86972 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 22', year: 2018, make: 'Ford', model: 'Transit Cargo', mileage: 69957 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 23', year: 2015, make: 'Ford', model: 'Transit Cargo', mileage: 77370 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 24', year: 2017, make: 'Ford', model: 'Transit Cargo', mileage: 71613 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 25', year: 2017, make: 'Ford', model: 'Transit Cargo', mileage: 69214 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 30', year: 2017, make: 'Ford', model: 'Transit Cargo', mileage: 86042 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 31', year: 2017, make: 'Ford', model: 'Transit Cargo', mileage: 83292 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 33', year: 2018, make: 'Ford', model: 'Transit Cargo', mileage: 86238 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 34', year: 2018, make: 'Ford', model: 'Transit Cargo', mileage: 82646 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 35', year: 2019, make: 'Ford', model: 'Transit Cargo', mileage: 81671 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 36', year: 2019, make: 'Ford', model: 'Transit Cargo', mileage: 67417 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 37', year: 2019, make: 'Ford', model: 'Transit Cargo', mileage: 67257 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 38', year: 2019, make: 'Ford', model: 'Transit Cargo', mileage: 59120 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 39', year: 2019, make: 'Ford', model: 'Transit Cargo', mileage: 73581 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 40', year: 2019, make: 'Ford', model: 'Transit Cargo', mileage: 60119 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 41', year: 2020, make: 'Ford', model: 'Transit Cargo', mileage: 51067 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 42', year: 2020, make: 'Ford', model: 'Transit Cargo', mileage: 64122 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 43', year: 2020, make: 'Ford', model: 'Transit Cargo', mileage: 61037 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 44', year: 2020, make: 'Ford', model: 'Transit Cargo', mileage: 57358 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 45', year: 2021, make: 'Ford', model: 'Transit Cargo', mileage: 48687 },
    { categoryId: getCat('Cargo Van w/ Liftgate'), unitName: 'Cargo 46', year: 2021, make: 'Ford', model: 'Transit Cargo', mileage: 42596 },

    // ─── Cube Trucks ───
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 5',  year: 2010, make: 'Ford', model: 'F-550', mileage: 138282 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 8',  year: 2011, make: 'Ford', model: 'F-550', mileage: 146902 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 9',  year: 2011, make: 'Ford', model: 'F-550', mileage: 133691 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 10', year: 2011, make: 'Ford', model: 'F-550', mileage: 143943 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 11', year: 2011, make: 'Ford', model: 'F-550', mileage: 145429 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 12', year: 2012, make: 'Ford', model: 'F-550', mileage: 130231 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 13', year: 2013, make: 'Ford', model: 'F-550', mileage: 125522 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 15', year: 2013, make: 'Ford', model: 'F-550', mileage: 129571 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 16', year: 2013, make: 'Ford', model: 'F-550', mileage: 138107 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 17', year: 2016, make: 'Ford', model: 'F-550', mileage: 101483 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 18', year: 2016, make: 'Ford', model: 'F-550', mileage: 116589 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 19', year: 2016, make: 'Ford', model: 'F-550', mileage: 93933 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 20', year: 2016, make: 'Ford', model: 'F-550', mileage: 108392 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 21', year: 2016, make: 'Ford', model: 'F-550', mileage: 91964 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 23', year: 2017, make: 'Ford', model: 'F-550', mileage: 97571 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 24', year: 2017, make: 'Ford', model: 'F-550', mileage: 78316 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 25', year: 2017, make: 'Ford', model: 'F-550', mileage: 107932 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 26', year: 2017, make: 'Ford', model: 'F-550', mileage: 100490 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 27', year: 2017, make: 'Ford', model: 'F-550', mileage: 105075 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 28', year: 2017, make: 'Ford', model: 'F-550', mileage: 105521 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 29', year: 2017, make: 'Ford', model: 'F-550', mileage: 103236 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 30', year: 2017, make: 'Ford', model: 'F-550', mileage: 85230 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 31', year: 2017, make: 'Ford', model: 'F-550', mileage: 83174 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 32', year: 2019, make: 'Ford', model: 'F-550', mileage: 76099 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 33', year: 2022, make: 'Ford', model: 'F-550', mileage: 29283 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 34', year: 2022, make: 'Ford', model: 'F-550', mileage: 34968 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 35', year: 2022, make: 'Ford', model: 'F-550', mileage: 39291 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 36', year: 2022, make: 'Ford', model: 'F-550', mileage: 36155 },
    { categoryId: getCat('Cube Truck'), unitName: 'Cube 37', year: 2022, make: 'Ford', model: 'F-550', mileage: 35201 },

    // ─── Camera Cubes ───
    { categoryId: getCat('Camera Cube'), unitName: 'Cam 1', year: 2011, make: 'Ford', model: 'F-550', mileage: 104029 },
    { categoryId: getCat('Camera Cube'), unitName: 'Cam 2', year: 2011, make: 'Ford', model: 'F-550', mileage: 106920 },

    // ─── PopVans ───
    { categoryId: getCat('PopVan'), unitName: 'Pop 3',  year: 2016, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 38388 },
    { categoryId: getCat('PopVan'), unitName: 'Pop 01', year: 2016, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 43077 },
    { categoryId: getCat('PopVan'), unitName: 'Pop 02', year: 2016, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 41755 },

    // ─── Passenger Vans ───
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 1',  year: 2017, make: 'Nissan', model: 'NV', mileage: 100094 },
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 2',  year: 2015, make: 'Ford', model: 'Wagon', mileage: 107140 },
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 6',  year: 2015, make: 'Ford', model: 'Wagon', mileage: 110092 },
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 7',  year: 2015, make: 'Ford', model: 'Wagon', mileage: 97602 },
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 8',  year: 2017, make: 'Ford', model: 'Wagon', mileage: 102703 },
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 9',  year: 2017, make: 'Ford', model: 'Wagon', mileage: 106637 },
    { categoryId: getCat('Passenger Van'), unitName: 'Pass 10', year: 2017, make: 'Ford', model: 'Wagon', mileage: 111356 },

    // ─── DLUX / ProScout ───
    { categoryId: getCat('DLUX'), unitName: 'DLUX 1', year: 2015, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 112831 },
    { categoryId: getCat('DLUX'), unitName: 'DLUX 2', year: 2015, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 127044 },
    { categoryId: getCat('DLUX'), unitName: 'DLUX 3', year: 2015, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 100929 },
    { categoryId: getCat('DLUX'), unitName: 'DLUX 4', year: 2015, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 108360 },
    { categoryId: getCat('ProScout / VTR'), unitName: 'ProScout 1', year: 2015, make: 'Mercedes-Benz', model: 'Sprinter', mileage: 75755 },
  ]

  console.log(`Seeding ${assets.length} assets...`)

  let created = 0
  for (const asset of assets) {
    await prisma.asset.upsert({
      where: { id: `seed-${asset.unitName.replace(/\s+/g, '-').toLowerCase()}` },
      update: { mileage: asset.mileage },
      create: {
        id: `seed-${asset.unitName.replace(/\s+/g, '-').toLowerCase()}`,
        ...asset,
        status: 'AVAILABLE',
        isActive: true,
      }
    })
    created++
    process.stdout.write(`\r${created}/${assets.length}`)
  }

  console.log(`\nDone! Seeded ${created} assets.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
