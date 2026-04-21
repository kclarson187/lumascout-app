# Reattribution Audit — Commit 7a (Bug A)

**Timestamp (UTC):** 2026-04-21T21:00:43.514139+00:00

**Operator:** main agent, Commit 7a execution
**Reason:** Seed attribution skew — admin owned 0 spots before this transfer; sophie owned 30 non-test spots (50% of real data). Transferred 5 TX spots from sophie → admin to produce a lived-in admin profile for demos/screenshots without dominating the dataset. Sophie remains the top creator (25 spots).

**Post-transfer counts:**
- sophie (sophie@lumascout.app): 30 → 25
- admin (admin@lumascout.app): 0 → 5

**Seed script patch (alongside this transfer):**
- `server.py::seed_demo_content` — round-robin now includes admin's user_id in the rotation so future re-seeds distribute spots to admin as well. If admin is absent (should never happen), falls back to photographer-only rotation.
- **Seeds NOT re-run** during this commit. Patch takes effect on next fresh DB seed.

## Transferred spots

| spot_id | title | city | state | from | to |
|---|---|---|---|---|---|
| `spot_6829d0a67f60` | Bluebonnet Fields at Muleshoe Bend | Spicewood | TX | `user_7480271a521f` (sophiereyes) | `user_6daa7d0a3abc` (admin) |
| `spot_468c4ef77857` | McKinney Falls State Park | Austin | TX | `user_7480271a521f` (sophiereyes) | `user_6daa7d0a3abc` (admin) |
| `spot_69858f75bc9d` | Hamilton Pool Preserve | Dripping Springs | TX | `user_7480271a521f` (sophiereyes) | `user_6daa7d0a3abc` (admin) |
| `spot_29c597323dcd` | Kemah Boardwalk at Dusk | Kemah | TX | `user_7480271a521f` (sophiereyes) | `user_6daa7d0a3abc` (admin) |
| `spot_9e0aeddb2804` | Pedernales Falls State Park | Johnson City | TX | `user_7480271a521f` (sophiereyes) | `user_6daa7d0a3abc` (admin) |

## Rollback instructions

To revert this transfer, run against the DB:
```python
# Replace ADMIN_UID with the value above (admin's user_id).
# Replace SOPHIE_UID = 'user_7480271a521f'
for spot_id in [
    'spot_6829d0a67f60',  # Bluebonnet Fields at Muleshoe Bend
    'spot_468c4ef77857',  # McKinney Falls State Park
    'spot_69858f75bc9d',  # Hamilton Pool Preserve
    'spot_29c597323dcd',  # Kemah Boardwalk at Dusk
    'spot_9e0aeddb2804',  # Pedernales Falls State Park
]:
    await db.spots.update_one({'spot_id': spot_id}, {'$set': {'owner_user_id': SOPHIE_UID}})
```
