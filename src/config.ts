export default {
  VITE_SERVER_HOST: import.meta.env.VITE_SERVER_HOST,
  VITE_OAUTH_REDIRECT_HOSTNAME:
    import.meta.env.VITE_OAUTH_REDIRECT_HOSTNAME ??
    (typeof window !== "undefined" ? window.location.origin : ""),
  VITE_FIREBASE_CONFIG:
    import.meta.env.VITE_FIREBASE_CONFIG ??
    '{"apiKey":"AIzaSyA9QOXwWHH4dBRny0j8C4wAk8TMqaQxqhc","authDomain":"dipkri-watchparty.firebaseapp.com","projectId":"dipkri-watchparty","storageBucket":"dipkri-watchparty.firebasestorage.app","messagingSenderId":"170664630998","appId":"1:170664630998:web:31ad27e51d90522a7a4777"}',
  VITE_FIREBASE_SIGNIN_METHODS: "facebook,google,email",
  NODE_ENV: import.meta.env.DEV ? "development" : "production",
};
