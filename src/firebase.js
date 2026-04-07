// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD0ZbCo4swkchf51jr0Jrh6DfrExwGw93Q",
  authDomain: "kronos-fcada.firebaseapp.com",
  databaseURL: "https://kronos-fcada-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kronos-fcada",
  storageBucket: "kronos-fcada.firebasestorage.app",
  messagingSenderId: "1087373672487",
  appId: "1:1087373672487:web:ae8af09338753081d54e02",
  measurementId: "G-PYLCGVQJZL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);