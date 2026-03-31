import { NextResponse } from 'next/server';
import { fetchServiceEntries } from '@/lib/fleetio';

export async function GET() {
  try {
    const data = await fetchServiceEntries(1);
    return NextResponse.json({ 
      count: data.length,
      sample: data.slice(0, 2).map((e: any) => ({
        id: e.id,
        vehicle_name: e.vehicle_name,
        status: e.status,
        date: e.date,
        vendor_name: e.vendor_name,
        total_amount: e.total_amount,
      }))
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
