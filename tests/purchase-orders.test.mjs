// Node >=22: node --experimental-strip-types --test tests/purchase-orders.test.mjs
// Set PO_TEST_PGLITE_PATH to a temporary @electric-sql/pglite/dist/index.js for SQL tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { purchaseOrderUsage } from '../lib/purchaseOrderUsage.ts';

for (const [used, warning] of [[799.99, 'none'], [800, 'yellow'], [900, 'yellow'], [900.01, 'red'], [1025, 'red']]) {
  test(`1000 MT PO at ${used} MT: ${warning}`, () => {
    const result = purchaseOrderUsage(1000, used);
    assert.equal(result.warning, warning);
    assert.equal(result.remaining, 1000 - used);
    assert.equal(result.exceeded, Math.max(0, used - 1000));
    assert.equal('status' in result, false);
  });
}

test('isolated SQL: permissions, snapshots, usage, cancellation and atomic draft attachment', {
  skip: !process.env.PO_TEST_PGLITE_PATH && 'Set PO_TEST_PGLITE_PATH to run isolated SQL checks',
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PO_TEST_PGLITE_PATH).href);
  const db = new PGlite();
  const actor = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      grant usage on schema auth,public to authenticated,anon;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.app_users(id uuid primary key);
      insert into public.app_users values ('${actor}'),('${other}');
      create table public.billing_parties(id bigint generated always as identity primary key,
        name text,code text,entry_status text default 'final');
      insert into public.billing_parties(name,code) values ('Party A','A'),('Party B','B');
      create table public.lrs(id bigint generated always as identity primary key,lr_number text,
        customer text,po_number text default '',loading_weight numeric default 0,
        status text default 'Open',entry_status text default 'final',created_by uuid);
      alter table public.lrs enable row level security;
      create policy lr_own on public.lrs to authenticated
        using (created_by=auth.uid()) with check (created_by=auth.uid());
      grant select,insert,update on public.lrs to authenticated;
      grant usage,select on sequence public.lrs_id_seq to authenticated;
      create table public.test_counter(n int); insert into public.test_counter values(100);
      create function public.has_module_action(k text,a text) returns boolean language sql stable as $$
        select auth.uid() is not null and (current_setting('test.access',true)='all'
          or position(k||':'||a in current_setting('test.access',true))>0) $$;
      create function public.has_permission(k text,a text) returns boolean language sql stable as $$
        select public.has_module_action(k,case when a='create_view' then 'create' else a end)
          or (a='view' and (public.has_module_action(k,'create') or public.has_module_action(k,'edit'))) $$;
      create function public.create_numbered_lr_draft(p_payload jsonb) returns jsonb
      language plpgsql security definer set search_path=public as $$
      declare r public.lrs; v_n int;
      begin
        if not public.has_module_action('lr','create') then raise exception 'Denied'; end if;
        update public.test_counter set n=n+1 returning n into v_n;
        insert into public.lrs(lr_number,customer,po_number,entry_status,created_by)
          values('LR'||v_n,p_payload->>'customer',coalesce(p_payload->>'po_number',''),'draft',auth.uid()) returning * into r;
        return to_jsonb(r);
      end $$;
      select set_config('test.uid','${actor}',false),set_config('test.access','all',false);
    `);
    await db.exec(await readFile(new URL('../database/migrations/073_purchase_order_master.sql', import.meta.url),'utf8'));
    const rows = async sql => (await db.query(sql)).rows;
    const scalar = async sql => Object.values((await rows(sql))[0])[0];
    const deny = sql => assert.rejects(() => db.query(sql));
    const asUser = access => db.exec(`reset role; select set_config('test.access','${access}',false); set role authenticated;`);
    const allPOs = () => scalar('select public.get_purchase_orders()');
    const po = async id => (await allPOs()).find(r => r.id===id);
    await asUser('all');
    await db.exec(`insert into public.purchase_orders(billing_party_id,po_number,issue_date,allotted_weight) values
      (1,'po-a','2026-09-01',1000),(1,'PO-A2','2026-09-02',1000),(1,'OLD','2026-08-01',1000),(2,'PO-B','2026-09-01',2000);
      update public.purchase_orders set status='Inactive' where po_number='OLD';`);
    await deny(`insert into public.purchase_orders(billing_party_id,po_number,issue_date,allotted_weight) values(1,' po-a ','2026-09-01',1000)`);
    await deny(`insert into public.purchase_orders(billing_party_id,po_number,issue_date,allotted_weight) values(1,'ZERO','2026-09-01',0)`);
    await asUser('lr:create');
    assert.deepEqual((await scalar(`select public.get_lr_purchase_orders(' party a ')`)).map(r=>r.po_number).sort(),['PO-A','PO-A2']);
    await deny('select public.get_purchase_orders()');
    assert.equal((await rows('select * from public.purchase_orders')).length,0);
    await deny(`insert into public.purchase_orders(billing_party_id,po_number,issue_date,allotted_weight) values(1,'DENIED','2026-09-01',1)`);
    await deny(`select public.create_numbered_lr_draft_with_po('{"customer":"Party B","purchase_order_id":1}')`);
    await db.exec('reset role');
    assert.equal(await scalar('select n from public.test_counter'),100,'failed attachment rolls back numbering');
    assert.equal(await scalar('select count(*)::int from public.lrs'),0);
    await asUser('lr:create');
    const draft=await scalar(`select public.create_numbered_lr_draft_with_po('{"customer":"PARTY A","purchase_order_id":1}')`);
    assert.equal(draft.lr_number,'LR101'); assert.equal(draft.po_number,'PO-A'); assert.equal(draft.po_date,'2026-09-01');
    await db.exec(`update public.lrs set loading_weight=800 where id=${draft.id}`);
    await asUser('all');
    assert.equal((await po(1)).used_weight,0,'drafts excluded');
    await db.exec(`update public.purchase_orders set status='Inactive' where id=1`);
    await deny(`update public.lrs set entry_status='final' where id=${draft.id}`);
    await db.exec(`update public.purchase_orders set status='Active' where id=1`);
    await db.exec(`update public.lrs set entry_status='final' where id=${draft.id}`);
    assert.equal((await po(1)).used_weight,800);
    await db.exec(`update public.lrs set loading_weight=1025 where id=${draft.id}`);
    assert.equal((await po(1)).used_weight,1025); assert.equal((await po(1)).status,'Active');
    await db.exec(`begin; update public.lrs set purchase_order_id=2 where id=${draft.id}`);
    assert.equal((await po(1)).used_weight,0); assert.equal((await po(2)).used_weight,1025);
    assert.equal(await scalar(`select po_number from public.lrs where id=${draft.id}`),'PO-A2');
    await db.exec(`update public.lrs set purchase_order_id=null,po_number='',po_date=null,customer='Party B' where id=${draft.id}`);
    assert.equal((await po(2)).used_weight,0,'clearing a PO link removes its usage');
    await db.exec('rollback');
    await db.exec(`update public.lrs set status='Cancelled' where id=${draft.id}`);
    assert.equal((await po(1)).used_weight,0);
    await deny(`update public.lrs set purchase_order_id=4 where id=${draft.id}`);
    await deny(`update public.lrs set po_date='2020-01-01' where id=${draft.id}`);
    await deny(`update public.purchase_orders set po_number='RENAMED' where id=1`);
    await db.exec(`update public.purchase_orders set status='Inactive',issue_date='2026-09-05' where id=1;
      update public.lrs set loading_weight=1026 where id=${draft.id}`);
    assert.equal(await scalar(`select po_date::text from public.lrs where id=${draft.id}`),'2026-09-01');
    await deny(`select public.create_numbered_lr_draft_with_po('{"customer":"Party A","purchase_order_id":1}')`);
    await db.exec('reset role');
    await db.exec(`insert into public.lrs(customer,purchase_order_id,loading_weight,created_by) values('Party A',2,50,'${other}')`);
    await asUser('purchase_orders:view');
    assert.equal((await rows('select * from public.lrs')).length,1,'other staff LR hidden');
    assert.equal((await po(2)).used_weight,50,'aggregate includes other staff');
    assert.equal((await rows(`update public.purchase_orders set status='Inactive' where id=2 returning id`)).length,0);
    assert.equal(await scalar('select status from public.purchase_orders where id=2'),'Active');
    await deny('delete from public.purchase_orders where id=1'); await deny('delete from public.purchase_order_audit');
    assert.ok((await rows('select * from public.purchase_order_audit')).length>0);
    await asUser('');
    await deny('select public.get_purchase_orders()'); await deny(`select public.get_lr_purchase_orders('Party A')`);
    await db.exec('reset role; set role anon'); await deny('select public.get_purchase_orders()');
  } finally { await db.close(); }
});
