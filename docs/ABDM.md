# ABDM and ABHA

Niveda links a patient's **ABHA** (Ayushman Bharat Health Account) through the
**Ayushman Bharat Digital Mission** APIs. This is ABDM milestone **M1**: verify the person
owns the ABHA (OTP from ABDM) and link it to their Niveda record.

## How it works

```
Patient (Profile → Link my ABHA)
   │  ABHA number or mobile
   ▼
abdm Edge Function ──► ABDM gateway session (client id + secret)
   │                  ► public key, encrypt the ABHA number (RSA-OAEP SHA-1)
   │                  ► /profile/login/request/otp      → ABDM texts a code
   │  code
   ▼                  ► /profile/login/verify           → X-token (or choose an account)
                      ► /profile/account                → ABHA profile
   name + DOB must match the Niveda record
   ▼
_link_abha (service role only) → abha_links + audit log
```

ABDM tokens never leave the Edge Function. Patients can't write a link themselves.

## Get access (you need to do this)

1. Register on the **ABDM Sandbox**: <https://sandbox.abdm.gov.in> → create an account →
   *Request Sandbox Access* for "ABHA / M1". You receive a **client ID** and **client secret**.
2. Deploy and configure:
   ```bash
   supabase functions deploy abdm
   supabase secrets set ABDM_CLIENT_ID=SBX_… ABDM_CLIENT_SECRET=…
   ```
   Then set `VITE_ABDM_ENABLED=true` for the app build so the ABHA card appears.
3. Test with sandbox ABHA numbers (create test ABHAs in the sandbox's ABHA app).
4. **Production**: complete ABDM's functional testing and *Production Exposure Request*; NHA
   gives production credentials and URLs. Set them without code changes:
   ```bash
   supabase secrets set ABDM_SESSION_URL=https://apis.abdm.gov.in/api/hiecm/gateway/v3/sessions \
     ABDM_ABHA_BASE=<production ABHA v3 base from NHA> ABDM_CM_ID=<production CM id>
   ```

Defaults (sandbox): session `https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions`, ABHA base
`https://abhasbx.abdm.gov.in/abha/api/v3`, CM id `sbx`. ABDM changes paths between versions — check the
sandbox docs and adjust these secrets if a call returns 404.

## Next milestones

| Milestone | What it adds | Notes |
|---|---|---|
| **M1** ✅ | Link ABHA, verify ownership | Built |
| **M1+** | Create a new ABHA from inside Niveda (Aadhaar OTP) | Needs the `enrollment` APIs and Aadhaar handling rules |
| **M2 — HIP** | Hospitals/patients can *pull* Niveda records into other ABDM apps as FHIR bundles, with ABDM consent artefacts | Register Niveda as a Health Information Provider; build FHIR R4 export of records |
| **M3 — HIU** | Niveda *fetches* a patient's records from hospitals on ABDM, with their consent | Register as Health Information User; consent request UI; import FHIR into the timeline |

M2/M3 are what make Niveda useful to hospitals and the government — they're the next big build.
