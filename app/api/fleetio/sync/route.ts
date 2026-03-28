import { NextResponse } from 'next/server';
import { fetchServiceEntries } from '@/lib/fleetio';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

export async function POST() {
  try {
    const assets = await prisma.asset.findMany({ select: { id: true, unitName: true } });
    const assetMap = new Map(assets.map(a => [a.unitName.trim(), a.id]));

    let page = 1;
    let allEntries: any[] = [];
    while (true) {
      const entries = await fetchServiceEntries(page);
      if (!entries || entries.length === 0) break;
      allEntries = allEntries.concat(entries);
      if (entries.length < 100) break;
      page++;
    }

    const now = new Date();
    const matched = allEntries
      .filter(e => e.vehicle_name && assetMap.has(e.vehicle_name.trim()))
      .map(e => ({
        id: randomUUID(),
        fleetioId: String(e.id),
        assetId: assetMap.get(e.vehicle_name.trim())!,
        unitName: e.vehicle_name.trim(),
        title: e.reference || `Service Entry #${e.id}`,
        description: e.general_notes || null,
        vendor: e.vendor_name || null,
        actualCost: e.total_amount ?? null,
        status: e.status === 'completed' ? 'COMPLETED' : 'SCHEDULED',
        startDate: e.date ? new Date(e.date) : now,
      }));

    const skipped = allEntries.length - matched.length;
    if (matched.length === 0) {
      return NextResponse.json({ success: true, totalSynced: 0, totalSkipped: skipped });
    }

    const values = matched.map((r, i) => {
      const base = i * 11;
      return `($${base+1},$${base+2},$${base+3},'REPAIR',$${base+4},$${base+5},$${base+6},$${base+7},$${base+8}::\"MaintenanceStatus\",$${base+9},$${base+10},NOW(),$${base+11})`;
    }).join(',');

    const params = matched.flatMap(r => [
      r.id,
      r.fleetioId,
      r.assetId,
      r.title,
      r.description,
      r.vendor,
      r.actualCost,
      r.status,
      r.startDate,
      now,
      r.unitName,
    ]);

    await prisma.$executeRawUnsafe(`
      INSERT INTO maintenance_records 
        (id, fleetio_id, asset_id, type, title, description, vendor, actual_cost, status, start_date, created_at, updated_at, unit_name)
      VALUES ${values}
      ON CONFLICT (fleetio_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        vendor = EXCLUDED.vendor,
        actual_cost = EXCLUDED.actual_cost,
        status = EXCLUDED.status,
        start_date = EXCLUDED.start_date,
        unit_name = EXCLUDED.unit_name,
        updated_at = NOW()
    `, ...params);

    return NextResponse.json({ success: true, totalSynced: matched.length, totalSkipped: skipped });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
