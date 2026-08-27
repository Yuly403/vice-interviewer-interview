import { Link } from "react-router-dom";
import "./NotFound.css";

export default function NotFound() {
  return (
    <div className="page not-found-page">
      <div className="nf-content">
        <h1 className="nf-code">404</h1>
        <p className="nf-title">页面不存在</p>
        <p className="nf-desc">
          你访问的页面可能已被删除、地址有误或暂时不可用。
        </p>
        <Link to="/" className="btn btn-primary">
          返回面试列表
        </Link>
      </div>
    </div>
  );
}
