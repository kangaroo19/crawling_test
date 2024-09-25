import puppeteer from "puppeteer";

(async () => {
  // 브라우저 실행
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // 특정 페이지로 이동
  await page.goto(
    "https://www.jumpit.co.kr/positions?jobCategory=2&sort=rsp_rate"
  );

  // 페이지가 로드될 때까지 대기 (클릭할 요소가 나타날 때까지)
  await page.waitForSelector(".dlByt");

  // 버튼 클릭 (필요 시)
  await page.click(".dlByt");

  // 스크롤 내리면서 데이터 로드
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100; // 스크롤 간격
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          // if (totalHeight >= 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 100); // 100ms 간격으로 스크롤
    });
  });

  // 스크롤 후, 클래스가 'position_card_info_title'인 모든 요소의 innerText 가져오기
  const jobTitles = await page.evaluate(() => {
    const elements = document.querySelectorAll(".sc-15ba67b8-1.iFMgIl");
    console.log(elements);
    return Array.from(elements).map((el) => el.innerText);
  });

  // 결과 출력

  const skillMap = new Map();
  const result = jobTitles
    .map((item) => item.split("\n"))
    .flat()
    .map((item2) => item2.replace("· ", ""));

  result.map((item) => {
    if (skillMap.has(item)) {
      skillMap.set(item, skillMap.get(item) + 1);
    } else {
      skillMap.set(item, 1);
    }
  });

  const total = Array.from(skillMap.values()).reduce(
    (sum, count) => sum + count,
    0
  );

  // 각 기술의 비율 구하기
  const percentageMap = new Map(
    Array.from(skillMap.entries()).map(([key, count]) => [
      key,
      ((count / total) * 100).toFixed(1),
    ])
  );

  // 비율 출력
  console.log(percentageMap);
  // 브라우저 종료
  await browser.close();
})();
