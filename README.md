### tải và cài đặt 
- Tải và cài đặt Thư viện [NodeJS] Phiên bản từ 18.x trở lên 
- Tài và cài đặt git 
 
### Tải mã nguồn 
- mở terminal / git bash chạy lệnh 
```sh 
git clone git push origin main --force

cd api-be-football 
```
### Cài thư viện 
```sh 
npm install 
```
 
 ### tạo file .env 
 ```sh
 ### Tạo File .env ở thư mục api-be-football

```env
APP_NAME="Football Booking"
MAIL_PROVIDER=SENDGRID

# MOMO CONFIG
MOMO_ACCESS_KEY=your_momo_access_key
MOMO_API_BASE_URL=https://test-payment.momo.vn
MOMO_IPN_URL=your_ipn_url
MOMO_LANG=vi
MOMO_PARTNER_CODE=your_partner_code
MOMO_PARTNER_NAME="Football Booking"
MOMO_REDIRECT_URL=your_redirect_url
MOMO_SECRET_KEY=your_momo_secret_key
MOMO_STORE_ID=FootballBooking

# DATABASE
MONGO_URI=your_mongodb_connection_string

# OTP
OTP_CODE_LENGTH=6
OTP_EXPIRES_MINUTES=5
OTP_MAX_ATTEMPTS=5
OTP_RESEND_SECONDS=60
OTP_SECRET=your_otp_secret

# SERVER
PORT=5555

# SENDGRID
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_API_URL=https://api.sendgrid.com/v3/mail/send
SENDGRID_FROM=your_email@gmail.com

# AUTH
TOKEN_SECRET=your_token_secret
```
### chạy dự án 
```sh 
npm run watch-ts
```
```sh
npm run watch-node 
```
