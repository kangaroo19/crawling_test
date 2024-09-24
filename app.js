import puppeteer from "puppeteer";

(async () => {
  // 브라우저 실행
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  // 구글로 이동
  await page.goto("https://www.google.com");

  // // 검색창에 검색어 입력 및 검색 실행
  await page.type("input", "Puppeteer");
  await page.keyboard.press("Enter");

  // // 페이지가 로딩될 때까지 대기
  await page.waitForSelector("h3");

  // // 검색 결과의 제목을 가져오기
  const titles = await page.evaluate(() => {
    const elements = document.querySelectorAll("h3");
    return Array.from(elements).map((el) => el.textContent);
  });

  // // 검색 결과 출력
  console.log(titles);

  // // 브라우저 종료
  await browser.close();
})();
