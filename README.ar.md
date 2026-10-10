# حزمة متابعة التقدم

متابعة تقدم المشروع من غير ما تتربط بأداة معينة. ملف JSON واحد هو المصدر، وأداة Node من غير أي مكتبات بتعدّل فيه،
وصفحة في المتصفح بتعرضه. بتشتغل زي بعض مع Claude وCodex وأي وكيل تاني وCursor وحتى لو إنت اللي بتشتغل بإيدك.

## هتاخد إيه

| الملف في الريبو بتاعك | بيعمل إيه |
| --- | --- |
| `docs/status/progress.json` | البيانات (المراحل والمهام وأوزانها وشغال دلوقتي والجاي والسجل) |
| `docs/status/progress.schema.json` | الـ Schema اللي الأداة بتتحقق بيه |
| `docs/status/index.html` | صفحة العرض في المتصفح (بتقرا الـ JSON وبتتحدّث لوحدها) |
| `scripts/progress.mjs` | الأداة (Node 20 أو أحدث، من غير مكتبات) |
| `scripts/install-hooks.mjs` و`.githooks/post-commit` | بيقفل المهمة لوحده من رسالة الكوميت |

## التركيب

```bash
cd /path/to/your/repo
npx github:Sayedelmahdy/progress-kit init      # --force لو عايز تستبدل ملفات الحزمة
node scripts/progress.mjs
```

الأمر مش بيمسح أي ملف موجود إلا لو كتبت `--force`، ومش بيلمس `progress.json` أبدًا. بيعمل نسخة فاضية
من `progress.json`، وبيضيف قسم "Progress tracking" في `AGENTS.md` و`CLAUDE.md`، وبيظبط `core.hooksPath` على `.githooks`.

## الاستخدام اليومي

```bash
node scripts/progress.mjs                             # النسبة الكلية وإنت فين والشغال والجاي وآخر السجل
node scripts/progress.mjs start B27 --who codex       # المهمة تبقى شغالة
node scripts/progress.mjs progress B27 0.6            # نسبة التقدم (من 0 لـ 1)
node scripts/progress.mjs done B27 --commit abc1234   # المهمة خلصت
node scripts/progress.mjs add p1 B40 "مهمة جديدة" --w 2
node scripts/progress.mjs validate                    # تحقق من الملف
```

ما تعدّلش الـ JSON بإيدك أبدًا، استخدم الأداة.

## التحديث التلقائي

اكتب رقم المهمة في آخر عنوان الكوميت: `feat(api): guest identity (B27)`، أو حط سطر `Progress: done B27, P3.1`.
الـ hook بيقفل المهمة ويسجّل الـ sha. الـ hook بيعدّل الملف بس ومش بيعمل كوميت، فالتعديل بيروح مع الكوميت الجاي.
ومش بيفشّل الكوميت أبدًا.

## إضافات اختيارية لـ Claude

ركّبها مرة واحدة على جهازك: `npx github:Sayedelmahdy/progress-kit install-claude` وبعدين اقفل Claude Code وافتحه.
بتقرا نفس الملف ومش لازمة: واجهة Claude في `~/.claude/skills/project-progress/` والوكيل في
`~/.claude/agents/progress-updater.md`. وجّههم لمشروعك بملف `.claude/progress-path.txt` فيه المسار الكامل لـ `progress.json`.

## أول مرة في مشروع

بعد `init` قول للوكيل بتاعك: "اقرا خطة المشروع وضيف المراحل والمهام بـ node scripts/progress.mjs add".
وكل واحد عامل clone للريبو يشغّل `node scripts/install-hooks.mjs` مرة واحدة.

البار اللي فوق الـ prompt في Claude معتمد على دعم الإضافات المحلي في Claude Code، وممكن ما يشتغلش في كل النسخ. الأداة والـ hook وصفحة المتصفح شغالين في أي حال.
