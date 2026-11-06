// Utilidades de pallets numerados (traslado por pallets).

// [1,2,3,5,6,9] -> "1-3, 5-6, 9"
export function comprimirRangos(nums) {
  const a = [...new Set(nums)].sort((x, y) => x - y);
  const out = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(i === j ? String(a[i]) : `${a[i]}-${a[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

// Trae todos los pallets (en páginas de 1000) de una planta: [{producto_id, numero, en_transito}]
export async function traerPallets(supabase, plantaId) {
  const todos = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await supabase
      .from("pallets")
      .select("producto_id, numero, en_transito")
      .eq("planta_id", plantaId)
      .order("producto_id")
      .order("numero")
      .range(desde, desde + 999);
    if (error) return { data: todos, error };
    todos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: todos, error: null };
}

// Agrupa por producto: { [producto_id]: { libres:number[], transito:number[] } }
export function agruparPallets(filas) {
  const m = {};
  for (const f of filas) {
    const g = (m[f.producto_id] ||= { libres: [], transito: [] });
    (f.en_transito ? g.transito : g.libres).push(f.numero);
  }
  return m;
}
