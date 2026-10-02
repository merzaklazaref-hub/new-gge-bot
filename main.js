const express = require('express');
const app = express();
app.use(express.urlencoded({extended:true}));

// لوحة التحكم نفسها تاع الصورة
app.get('/', (req,res)=>{
 res.send(`
 <html><body style="background:#020705;color:#0f0;font-family:monospace;margin:0;padding:10px">
 <div style="border:2px solid #0f0;min-height:95vh;padding:15px">
   <div style="border-bottom:1px solid #0f0;padding-bottom:8px">[CONFIG_USER] // ${process.env.USER || 'Manar_203'} - SERVER ONLINE ✅</div>
   <div style="text-align:center;margin:20px"><button style="background:#001a0f;border:1px solid #0f0;color:#0f0;padding:8px 20px">▶ Account Credentials</button></div>
   <div style="text-align:center;color:#555;letter-spacing:3px">> CONFIGURE_PLUGINS</div>
   <div style="border:1px solid #0f0;margin-top:15px">
     <div style="padding:10px;border-bottom:1px solid #003300">مهمة فارس (الصحراء الحارقة) ✅</div>
     <div style="padding:10px;border-bottom:1px solid #003300">مهمة فارس (الجليد الأبدي)</div>
     <div style="padding:10px;border-bottom:1px solid #003300">مهمة فارس (الاسطورية)</div>
     <div style="padding:10px">Toolsmith</div>
     <div style="background:#000;border-top:2px solid #0f0;padding:40px;text-align:center;color:#fff">// SELECT A PLUGIN TO CONFIGURE<br><br>السيرفر راهو خدام حتى و البيسي طافي</div>
   </div>
 </div>
 </body></html>
 `);
});

// هذا السطر هو السر باش يخدم في البيسي وفي Render في نفس الوقت
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log('Dashboard live on '+PORT));

// هنا كود البوت تاعك
// require('./bot').start();
