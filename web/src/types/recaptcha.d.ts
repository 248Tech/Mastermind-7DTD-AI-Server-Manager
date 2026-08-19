export {};
declare global {
  interface Window {
    grecaptcha?: {
      render(element:HTMLElement,options:{sitekey:string;theme?:'dark'|'light'}):number;
      getResponse(widgetId?:number):string;
      reset(widgetId?:number):void;
    };
  }
}
