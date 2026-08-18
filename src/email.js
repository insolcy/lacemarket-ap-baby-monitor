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

export function buildAlertEmail(listings) {
  const groups = Map.groupBy(listings, (listing) => listing.brandKey);
  const subject = `[Lace Market 上新] AP/BABY 裙装（${listings.length}件）`;
  const textSections = [];
  const htmlSections = [];

  for (const [brandKey, brandListings] of groups) {
    const brandName = brandKey === "ap" ? "Angelic Pretty（AP）" : "Baby, the Stars Shine Bright（BABY）";
    textSections.push(
      `${brandName}\n${brandListings
        .map(
          (listing) =>
            `- ${listing.title}\n  价格：${listing.price}\n  状态：${listing.condition}\n  卖家地区：${listing.sellerLocation}\n  链接：${listing.url}`,
        )
        .join("\n\n")}`,
    );

    htmlSections.push(`
      <h2>${escapeHtml(brandName)}</h2>
      <ul>
        ${brandListings
          .map(
            (listing) => `
              <li style="margin-bottom: 18px">
                <a href="${escapeHtml(listing.url)}"><strong>${escapeHtml(listing.title)}</strong></a><br>
                价格：${escapeHtml(listing.price)}<br>
                状态：${escapeHtml(listing.condition)}<br>
                卖家地区：${escapeHtml(listing.sellerLocation)}<br>
                <a href="${escapeHtml(listing.url)}">打开商品页面</a>
              </li>`,
          )
          .join("")}
      </ul>`);
  }

  return {
    subject,
    text: `Lace Market 检测到 ${listings.length} 件新上架裙装。\n\n${textSections.join("\n\n")}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222">
        <h1>Lace Market 新上架裙装</h1>
        <p>本轮共检测到 ${listings.length} 件新品。</p>
        ${htmlSections.join("")}
      </div>`,
  };
}
