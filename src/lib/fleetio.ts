const FLEETIO_BASE_URL = 'https://secure.fleetio.com/api/v1';

function getHeaders() {
  return {
    'Authorization': `Token token=${process.env.FLEETIO_API_KEY}`,
    'Account-Token': process.env.FLEETIO_ACCOUNT_TOKEN!,
    'Content-Type': 'application/json',
  };
}

export async function fetchServiceEntries(page = 1): Promise<any[]> {
  const res = await fetch(
    `${FLEETIO_BASE_URL}/service_entries?page=${page}&per_page=100`,
    { headers: getHeaders() }
  );

  if (!res.ok) {
    throw new Error(`Fleetio API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
