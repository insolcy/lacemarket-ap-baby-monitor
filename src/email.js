function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildRecipients(sender, additionalRecipients = "") {
  return [
    ...new Set(
      [sender, ...String(additionalRecipients).split(",")]
        .map((recipient) => recipient.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeMailbox(value) {
  if (value && typeof value === "object" && "address" in value) {
    return String(value.address).trim().toLowerCase();
  }

  const text = String(value || "").trim();
  const bracketedAddress = text.match(/<([^>]+)>/);
  return (bracketedAddress?.[1] || text).trim().toLowerCase();
}

export function assertAllRecipientsAccepted(recipients, deliveryInfo) {
  const expected = [...new Set(recipients.map(normalizeMailbox).filter(Boolean))];
  const accepted = new Set(
    (deliveryInfo?.accepted || []).map(normalizeMailbox).filter(Boolean),
  );
  const rejectedCount = Array.isArray(deliveryInfo?.rejected)
    ? deliveryInfo.rejected.length
    : 0;
  const missingCount = expected.filter((recipient) => !accepted.has(recipient)).length;
  const acceptedExpectedCount = expected.length - missingCount;

  if (expected.length === 0 || missingCount > 0 || rejectedCount > 0) {
    throw new Error(
      `SMTP did not accept every recipient ` +
        `(accepted=${acceptedExpectedCount}/${expected.length}, rejected=${rejectedCount})`,
    );
  }

  return { acceptedCount: acceptedExpectedCount, recipientCount: expected.length };
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function buildAlertEmail(listings, { testMode = false } = {}) {
  const groups = Map.groupBy(listings, (listing) => listing.brandKey);
  const subject = testMode
    ? `[Lace Market 流程测试] AP/BABY 裙装（${listings.length}件）`
    : `[Lace Market 上新] AP/BABY 裙装（${listings.length}件）`;
  const heading = testMode ? "Lace Market 监控流程测试" : "Lace Market 新上架裙装";
  const intro = testMode
    ? "这是一封端到端流程测试邮件。下列商品仅用于验证页面解析和邮件投递，不代表本轮真实上新，也不会改变监控水位线。"
    : `Lace Market 检测到 ${listings.length} 件新上架裙装。`;
  const textSections = [];
  const htmlSections = [];

  for (const [brandKey, brandListings] of groups) {
    const brandName = brandKey === "ap" ? "Angelic Pretty（AP）" : "Baby, the Stars Shine Bright（BABY）";
    textSections.push(
      `${brandName}\n${brandListings
        .map(
          (listing) => {
            const imageUrl = safeImageUrl(listing.imageUrl);
            return `- ${listing.title}\n  价格：${listing.price}\n  状态：${listing.condition}\n  卖家地区：${listing.sellerLocation}${imageUrl ? `\n  图片：${imageUrl}` : ""}\n  链接：${listing.url}`;
          },
        )
        .join("\n\n")}`,
    );

    htmlSections.push(`
      <h2>${escapeHtml(brandName)}</h2>
      <ul>
        ${brandListings
          .map((listing) => {
            const imageUrl = safeImageUrl(listing.imageUrl);
            return `
              <li style="margin-bottom: 18px">
                <a href="${escapeHtml(listing.url)}"><strong>${escapeHtml(listing.title)}</strong></a><br>
                ${
                  imageUrl
                    ? `<a href="${escapeHtml(listing.url)}"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(listing.title)}" width="280" style="display:block;max-width:100%;height:auto;margin:10px 0;border-radius:6px"></a>`
                    : ""
                }
                价格：${escapeHtml(listing.price)}<br>
                状态：${escapeHtml(listing.condition)}<br>
                卖家地区：${escapeHtml(listing.sellerLocation)}<br>
                <a href="${escapeHtml(listing.url)}">打开商品页面</a>
              </li>`;
          })
          .join("")}
      </ul>`);
  }

  return {
    subject,
    text: `${intro}\n\n${textSections.join("\n\n")}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222">
        <h1>${escapeHtml(heading)}</h1>
        <p>${escapeHtml(intro)}</p>
        ${htmlSections.join("")}
      </div>`,
  };
}
