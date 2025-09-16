// Middleware for standardized API responses
const responseHandler = (req, res, next) => {
  res.success = (data = {}, message = "Success") => {
    res.json({ success: true, message, data });
  };

  res.error = (message = "Error", code = 500) => {
    res.status(code).json({ success: false, message });
  };

  next();
};

module.exports = responseHandler;
