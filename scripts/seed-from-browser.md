# Seed inicial para Supabase

Este projeto mantém `ALUNOS` e usuários padrão no front legado.  
Após rodar `supabase/schema.sql`, você pode popular `alunos` com este script no console do navegador:

```js
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.APP_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem("enau_app_session_v1")).token}` } },
});

const chunk = (arr, size = 200) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

for (const part of chunk(ALUNOS, 200)) {
  const { error } = await sb.from("alunos").upsert(part, { onConflict: "ra" });
  if (error) {
    console.error(error);
    break;
  }
  console.log("Chunk enviado:", part.length);
}
console.log("Importação concluída");
```

Observações:
- Faça login como `admin` primeiro para obter token com `app_role = admin`.
- A tabela de usuários já é seeded no SQL (`admin`, `enau`).

