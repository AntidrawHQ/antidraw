// Stub auth — will be replaced with real Google OAuth later

let authenticated = false;

export const isAuthenticated = () => authenticated;

export const setAuthenticated = (value: boolean) => {
  authenticated = value;
};
