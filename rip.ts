function sql<const TSA extends readonly string[], VS extends any[]>(
  texts: TSA,
  ...values: VS
): [TSA, VS] {
  return [texts, values];
}

const ha = sql`SELECT * FROM users`;

function sql2<const S extends `select * from ${string}`>(s: S) {}
