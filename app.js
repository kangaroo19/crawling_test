import express from "express";
import mysql from "mysql2/promise";
import puppeteer from "puppeteer";
import { dbConfig } from "./db.config.js";
import cors from "cors";

const app = express();
const PORT = 5555;
const positionList = new Map([
  [1, "backend"],
  [2, "frontend"],
  [4, "android"],
  [16, "ios"],
]);

// JSON 파싱을 위한 미들웨어
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// MySQL 연결 함수
const connectToDatabase = async () => {
  const connection = await mysql.createConnection(dbConfig);
  return connection;
};

// job_listings 테이블 생성 함수
async function createJobListingsTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS job_listings (
      id VARCHAR(255),
      title VARCHAR(255) NOT NULL,
      link TEXT NOT NULL,
      company VARCHAR(255) NOT NULL,
      skills TEXT,
      type VARCHAR(50),
      date DATE NOT NULL,
      PRIMARY KEY (id, date)
    )
  `);
}

// 오래된 컬럼 관리 로직
async function manageColumns(connection, tableName, today) {
  const newColumn = today.replace(/-/g, "_");

  // 1. 테이블의 현재 컬럼 목록 가져오기
  const [columns] = await connection.execute(`
    SHOW COLUMNS FROM ${tableName};
  `);

  // 2. 날짜 컬럼만 필터링 (YYYY_MM_DD 형식)
  const dateColumns = columns
    .map((col) => col.Field)
    .filter((field) => /^\d{4}_\d{2}_\d{2}$/.test(field));

  // 3. 오래된 컬럼 관리 (최대 10개 유지)
  if (dateColumns.length >= 10) {
    const oldestColumn = dateColumns.sort()[0];
    await connection.execute(`
      ALTER TABLE ${tableName} DROP COLUMN ${oldestColumn};
    `);
  }

  // 4. 새 컬럼이 없으면 추가
  const columnExists = dateColumns.includes(newColumn);
  if (!columnExists) {
    await connection.execute(`
      ALTER TABLE ${tableName} ADD COLUMN ${newColumn} INT DEFAULT 0;
    `);
  }
}

// 크롤링 및 데이터 저장 API
app.post("/crawl", async (req, res) => {
  const { jobCategory } = req.body;
  const type = positionList.get(jobCategory);

  if (!jobCategory || !type) {
    return res.status(400).send({ error: "Invalid or missing jobCategory" });
  }

  const connection = await connectToDatabase();

  // job_listings 테이블 생성
  await createJobListingsTable(connection);

  // skill_progress_backend 테이블 생성
  const tableName = `skill_progress_${type}`;
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      skill_name VARCHAR(255) PRIMARY KEY
    )
  `);

  // 현재 날짜 컬럼 관리
  const today = new Date().toISOString().slice(0, 10);
  await manageColumns(connection, tableName, today);

  // Puppeteer를 이용한 크롤링 로직
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(
    `https://www.jumpit.co.kr/positions?jobCategory=${jobCategory}&sort=rsp_rate`
  );
  await page.waitForSelector(".fJjUyN");

  // 페이지 스크롤
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });

  // 크롤링 데이터 추출
  const jobListings = await page.evaluate(() => {
    const listings = Array.from(document.querySelectorAll("a[target='_self']"));

    return listings.map((listing) => {
      const title = listing.querySelector(
        ".position_card_info_title"
      ).innerText;
      const link = document.location.origin + listing.getAttribute("href");
      const company = listing.querySelector(
        ".sc-15ba67b8-2.ixzmqw span"
      ).innerText;
      const skills = Array.from(
        listing.querySelectorAll(".sc-15ba67b8-1.iFMgIl li")
      )
        .map((skill) => skill.innerText.trim().replace("· ", ""))
        .filter((skill) => skill);

      const id = link.split("/").pop();
      return { id, title, link, company, skills };
    });
  });

  // 데이터 저장
  for (const job of jobListings) {
    const { title, link, company, skills } = job;
    const id = link.split("/").pop();

    // job_listings 데이터 삽입 또는 업데이트
    await connection.execute(
      `
        INSERT INTO job_listings (id, title, link, company, skills, type, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          link = VALUES(link),
          company = VALUES(company),
          skills = VALUES(skills),
          type = VALUES(type)
      `,
      [id, title, link, company, skills, type, today]
    );
  }

  await browser.close();
  await connection.end();

  res.send({ message: "크롤링 및 데이터 저장 완료" });
});

// 데이터 조회 API
app.get("/progress/:type", async (req, res) => {
  const { type } = req.params;
  const tableName = `skill_progress_${type}`;

  const connection = await connectToDatabase();
  const [rows] = await connection.execute(`SELECT * FROM ${tableName}`);
  await connection.end();

  res.json(rows);
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
