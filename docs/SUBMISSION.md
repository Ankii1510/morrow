# Submission kit

Everything needed to submit, prepared for the founder. **Nothing here has been sent, posted or published.** Per HACKATHON.md, the founder supplies the personal values, publishes the X post personally, and confirms the exact payload before it is sent. One attempt per repository.

Deadline: **2026-11-14 23:59 UTC**. Re-read https://nearhackathon.com/HACKATHON.md immediately before submitting.

## Submitted

Submitted on 2026-11-14 at 15:29 UTC through the official API (HTTP 201, saved). Track: `privacy`.
Demo post: https://x.com/anki_anc/status/2121625504214303162

**Do not submit this repository again.** To correct anything, the founder uses https://nearhackathon.com/request-changes.
The repository must stay public through judging (16 to 18 November 2026).

## Status before submission (2026-11-14 15:15 UTC)

- Public repository: https://github.com/nehaiqoo-source/morrow (commit `ef6da3f` plus README updates). Verified from a fresh clone.
- Still to do, all by the founder: record the demo video, publish the X post, create or choose the mainnet NEAR account, submit.

## Order of operations

1. Record the demo video (script below). The app is running locally with the four sample documents and three saved answers.
2. Publish the X post with the video. Copy its URL.
3. Submit at https://nearhackathon.com/#apply with the values below, before 23:59 UTC. One attempt per repository.

## Form values

| Field | Value |
| --- | --- |
| Project name | `Morrow` |
| Team lead's name | founder to enter |
| Contact email | founder to enter |
| Team size | founder to choose: `1`, `2 - 4`, `4 - 6`, `6 - 8` or `8+` |
| Tracks | `privacy` (Privacy & Private AI) |
| NEAR account (mainnet) | founder to enter, for example `name.near`. Must already exist in a NEAR wallet |
| Repository | `https://github.com/nehaiqoo-source/morrow` |
| Demo post | the URL of the X post, after it is published |
| What you built | the text below |
| Consent | tick only after reading: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." |

If a mistake is made after submitting, do not submit again. Use https://nearhackathon.com/request-changes.

## Draft `idea` text (1,274 characters; limit 2,000)

> People keep their most sensitive information in documents: leases, medical results, insurance, contracts. AI is good at answering questions about them, but that normally means handing the files to a provider and trusting a privacy policy, and you cannot tell which sentence came from your file.
>
> Morrow is a personal knowledge library. You add PDFs, text and Markdown, search them by wording and meaning, and ask questions. Answers are written only from your documents, and every claim cites the passage and page, which opens highlighted in the original. If your documents do not say, Morrow says so.
>
> NEAR AI Cloud makes this private in a way you can check. Embedding, reranking and answering all run on TEE-hosted models. Before sending anything, Morrow verifies the gateway and model enclaves with a fresh nonce (Intel TDX quote, NVIDIA GPU evidence, TLS key binding) using the official SDK, encrypts the question end-to-end to the enclave's attested key, and verifies the enclave's signature on the response. Each answer has a receipt you can re-verify with a standalone script. If verification fails, nothing is sent. There is no fallback provider and no simulated badge. A Privacy Center shows exactly what is stored, what leaves the server, and what is not protected.

## Draft X post (founder edits and posts)

> Your lease, your blood tests, your insurance policy: the documents you most want to ask an AI about are the ones you least want to upload.
>
> I built Morrow at NEAR HACKATHON. Ask your own documents anything, get answers with citations to the exact page, and get proof the AI ran inside a hardware enclave on NEAR AI Cloud: private inference you can verify yourself, not a privacy policy.
>
> Demo below. Code: https://github.com/nehaiqoo-source/morrow
>
> What would you want to check before trusting an AI with your documents?
>
> @NEARProtocol #NEARHackathon

Optional extra tags: @NearLegion @NearBuilders. Attach the video.

## Demo video script (about 90 seconds, screen recording)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Library with the four sample documents | "These are the kind of documents everyone has and nobody wants to upload to an AI: a lease, an insurance policy, a health summary." |
| 0:10 | Ask: `When does my lease end and how much notice do I need to give?` | "Morrow answers only from my documents." |
| 0:25 | Answer appears with citation chips | "Every claim has a citation." |
| 0:32 | Click a citation → Open in document → highlighted passage | "It opens the original at the exact passage." |
| 0:42 | Ask: `What is my passport number?` | "If my documents don't say, it tells me. It doesn't guess." |
| 0:52 | Expand "Verified private inference" | "Here is NEAR's role. Before sending anything, Morrow verified that the gateway and the model run in genuine hardware enclaves on NEAR AI Cloud, with a fresh nonce. The question was encrypted to the enclave's key and the answer was signed inside it." |
| 1:08 | Download receipt; terminal: `npm run verify:receipt -- <file>` → `VERIFIED` | "And I don't have to trust Morrow: this script re-checks the Intel attestation and the signature independently." |
| 1:20 | Privacy Center, scroll to "What is not protected" | "The Privacy Center shows what's stored, what leaves the server, and what isn't protected." |
| 1:28 | Delete a document | "And delete means delete." |

## Final pre-submission checklist (from SUBMITTING.md)

- [ ] Repository is public and the README steps work from a fresh clone
- [ ] X post is live, says built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, video attached
- [ ] Mainnet NEAR account exists for payout
- [ ] Tracks confirmed
- [ ] No keys or secrets anywhere in the repo history
- [ ] Submitted before 2026-11-14 23:59 UTC
- [ ] Founder saw the full payload and said yes
