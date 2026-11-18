# Held-out evaluation set

This folder is for real examples that measure how well Prevenza works. It is empty on purpose. Nobody has collected a set yet, so **Prevenza has no accuracy figure**, and none may be claimed.

Run `npm run eval:holdout` to evaluate whatever `.jsonl` files are here. Below 50 examples, or without both scams and legitimate messages, the script prints counts only and no rates.

## Rules (all of them matter)

1. **Collect first, look later.** Gather the examples before anyone runs them through Prevenza or reads the rules.
2. **Never tune on this set.** If a result is wrong, do not change a rule because of that example. Rules are improved with the invented examples in `scripts/detection-check.js` and the unit tests. Once a rule has changed, start a new set; the old one is no longer held out.
3. **Include both sides.** Real scams, and real legitimate messages of the same kinds: bank alerts, OTP deliveries, delivery updates, job offers, family messages. Without legitimate examples, false alarms cannot be measured.
4. **Remove private details.** Replace real names, phone numbers, account numbers, UPI IDs of real people and addresses with placeholders such as `NAME`, `PHONE` or `name@bank`. Keep scammer links and scammer UPI IDs only if they are already public (for example in a news report or a police advisory).
5. **Record where each example came from** (`source`) and when it was collected (`collected`, year and month).
6. **Report honestly.** Give the rates with their 95% intervals, the number of examples, the date and how the set was collected. Inconclusive results count as neither right nor wrong.

## File format

One example per line (JSON Lines), in files ending in `.jsonl`:

```
{"kind":"message","label":"scam","text":"...","source":"forwarded by a volunteer","collected":"2026-11"}
{"kind":"message","label":"legit","text":"...","source":"own bank SMS","collected":"2026-11"}
{"kind":"url","label":"scam","url":"https://...","source":"police advisory","collected":"2026-11"}
{"kind":"upi","label":"scam","payment":{"upiId":"name@bank","amount":"4999","reason":"..."},"source":"...","collected":"2026-11"}
```

`label` is `scam` or `legit`. A result of Medium or higher counts as a warning.

Collected files can contain sensitive material. Decide with your team whether they should be committed. If not, add `data/holdout/*.jsonl` to `.gitignore`.
